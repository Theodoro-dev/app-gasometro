'use strict';

const db = require('../db');
const config = require('../config');
const wa = require('./whatsapp');

// A consulta do guia (Fase 6): alertas que ainda nao foram avisados no canal.
// Foi enriquecida com os dados da view para montar a mensagem.
const PENDENTES_SQL = `
SELECT a.id              AS alerta_id,
       a.tipo,
       a.data_referencia,
       a.medidor_id,
       m.nome_apelido,
       m.identificador_esp32,
       u.id              AS usuario_id,
       u.email,
       c.id              AS canal_id,
       c.tipo            AS canal,
       c.destino,
       cd.consumo_kg,
       n.gas_restante_kg,
       n.percentual_restante,
       n.status_nivel,
       md.media_consumo_dia,
       p.data_estimada_troca
  FROM tb_alertas a
  JOIN tb_medidores m           ON m.id = a.medidor_id
  JOIN tb_usuarios u            ON u.local_id = m.local_id
  JOIN tb_canais_notificacao c  ON c.usuario_id = u.id AND c.ativo = TRUE
  LEFT JOIN tb_consumo_diario cd ON cd.medidor_id = a.medidor_id AND cd.data = a.data_referencia
  LEFT JOIN vw_nivel_atual n     ON n.medidor_id = a.medidor_id
  LEFT JOIN vw_media_consumo md  ON md.medidor_id = a.medidor_id
  LEFT JOIN vw_previsao_troca p  ON p.medidor_id = a.medidor_id
 WHERE NOT EXISTS (
       SELECT 1 FROM tb_notificacoes_enviadas ne
        WHERE ne.alerta_id = a.id AND ne.canal_id = c.id)
 ORDER BY a.data_referencia ASC, a.id ASC
 LIMIT ?`;

async function registrarEnvio({ alertaId, canalId, provedor, modo, status, mensagem, link, erro, tentativas = 1 }) {
  await db.query(
    `INSERT INTO tb_notificacoes_enviadas
        (alerta_id, canal_id, provedor, modo, status, mensagem, link_whatsapp, erro, tentativas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [alertaId, canalId, provedor, modo, status, mensagem, link, erro, tentativas]
  );
}

async function paraFila({ alertaId, canalId, tentativas = 0, status = 'PENDENTE' }) {
  await db.query(
    `INSERT INTO tb_whatsapp_fila (alerta_id, canal_id, tentativas, ultima_tentativa, status)
     VALUES (?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE tentativas = VALUES(tentativas),
                             ultima_tentativa = NOW(),
                             status = VALUES(status)`,
    [alertaId, canalId, tentativas, status]
  );
}

function montarMensagem(item) {
  if (item.canal === 'WHATSAPP') return wa.textoAlerta(item);
  return wa.textoAlerta(item);
}

/**
 * Varre a fila e envia o que falta. Rodar de novo nunca duplica: a chave
 * unica (alerta_id, canal_id) em tb_notificacoes_enviadas impede.
 */
async function processarPendentes({ limite = 50 } = {}) {
  const resumo = { novos: 0, enviados: 0, simulados: 0, erros: 0, reenviados: 0, pendentes: 0 };

  // 1) Alertas que ainda nao tem nenhuma notificacao.
  const pendentes = await db.query(PENDENTES_SQL, [limite]);
  resumo.novos = pendentes.length;

  for (const item of pendentes) {
    const texto = montarMensagem(item);
    const r = await wa.enviar(item.destino, texto);

    if (r.status === 'ERRO') {
      resumo.erros += 1;
      await paraFila({ alertaId: item.alerta_id, canalId: item.canal_id, tentativas: 1 });
      continue;
    }

    await registrarEnvio({
      alertaId: item.alerta_id,
      canalId: item.canal_id,
      provedor: r.provedor,
      modo: r.modo,
      status: r.status,
      mensagem: texto,
      link: r.link_whatsapp,
      erro: null,
    });
    if (r.status === 'SIMULADO') resumo.simulados += 1;
    else resumo.enviados += 1;
  }

  // 2) Reenvio do que ficou na fila (provedor fora do ar, por exemplo).
  const fila = await db.query(
    `SELECT f.id, f.alerta_id, f.canal_id, f.tentativas, c.tipo AS canal, c.destino
       FROM tb_whatsapp_fila f
       JOIN tb_canais_notificacao c ON c.id = f.canal_id
      WHERE f.status = 'PENDENTE'
        AND f.tentativas < ?
      ORDER BY f.criado_em ASC
      LIMIT ?`,
    [config.notificacoes.maxTentativas, limite]
  );

  for (const f of fila) {
    const [dados] = await db.query(
      `SELECT a.tipo, a.data_referencia, a.medidor_id, m.nome_apelido,
              cd.consumo_kg, n.gas_restante_kg, n.percentual_restante,
              md.media_consumo_dia, p.data_estimada_troca
         FROM tb_alertas a
         JOIN tb_medidores m ON m.id = a.medidor_id
         LEFT JOIN tb_consumo_diario cd ON cd.medidor_id = a.medidor_id AND cd.data = a.data_referencia
         LEFT JOIN vw_nivel_atual n ON n.medidor_id = a.medidor_id
         LEFT JOIN vw_media_consumo md ON md.medidor_id = a.medidor_id
         LEFT JOIN vw_previsao_troca p ON p.medidor_id = a.medidor_id
        WHERE a.id = ?`,
      [f.alerta_id]
    );
    if (!dados) {
      await db.query(`UPDATE tb_whatsapp_fila SET status = 'DESISTIU' WHERE id = ?`, [f.id]);
      continue;
    }

    const texto = montarMensagem({ ...dados, canal: f.canal });
    const r = await wa.enviar(f.destino, texto);
    const tentativas = f.tentativas + 1;

    if (r.status === 'ERRO') {
      resumo.erros += 1;
      if (tentativas >= config.notificacoes.maxTentativas) {
        await paraFila({ alertaId: f.alerta_id, canalId: f.canal_id, tentativas, status: 'DESISTIU' });
        await registrarEnvio({
          alertaId: f.alerta_id, canalId: f.canal_id, provedor: r.provedor, modo: r.modo,
          status: 'ERRO', mensagem: texto, link: r.link_whatsapp, erro: r.erro, tentativas,
        });
      } else {
        await paraFila({ alertaId: f.alerta_id, canalId: f.canal_id, tentativas });
        resumo.pendentes += 1;
      }
      continue;
    }

    await paraFila({ alertaId: f.alerta_id, canalId: f.canal_id, tentativas, status: 'ENVIADO' });
    await registrarEnvio({
      alertaId: f.alerta_id, canalId: f.canal_id, provedor: r.provedor, modo: r.modo,
      status: r.status, mensagem: texto, link: r.link_whatsapp, erro: null, tentativas,
    });
    resumo.reenviados += 1;
    if (r.status === 'SIMULADO') resumo.simulados += 1;
    else resumo.enviados += 1;
  }

  return resumo;
}

/** Envia uma mensagem de teste para um canal especifico. */
async function enviarTeste(canalId) {
  const canal = await db.um(
    `SELECT c.id, c.tipo, c.destino, u.id AS usuario_id, l.nome_local
       FROM tb_canais_notificacao c
       JOIN tb_usuarios u ON u.id = c.usuario_id
       JOIN tb_locais l   ON l.id = u.local_id
      WHERE c.id = ? AND c.ativo = TRUE`,
    [canalId]
  );
  if (!canal) return { ok: false, erro: 'Canal inexistente ou inativo.' };

  const texto = wa.textoTeste(canal.nome_local);
  const r = await wa.enviar(canal.destino, texto);
  return { ok: r.status !== 'ERRO', ...r, mensagem: texto, canal };
}

let timer = null;

/** Liga o worker periodico que faz o aviso sair sozinho. */
function iniciarWorker(log = console) {
  if (!config.notificacoes.ativo || timer) return null;
  const rodar = async () => {
    try {
      const r = await processarPendentes();
      const total = r.enviados + r.simulados + r.reenviados;
      if (total > 0 || r.erros > 0) {
        log.log(
          `[notificacoes] alertas novos=${r.novos} enviados=${r.enviados} simulados=${r.simulados} ` +
          `reenviados=${r.reenviados} erros=${r.erros}`
        );
      }
    } catch (e) {
      log.error('[notificacoes] falha na varredura:', e.message);
    }
  };
  timer = setInterval(rodar, Math.max(10, config.notificacoes.intervaloSeg) * 1000);
  if (timer.unref) timer.unref();
  setTimeout(rodar, 5000);
  return timer;
}

function pararWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { processarPendentes, enviarTeste, iniciarWorker, pararWorker, PENDENTES_SQL };