'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();
router.use(auth.exigirLogin);

// ---------------------------------------------------------------------
// Ajudantes: nada sai da API sem pertencer ao local do usuario logado.
// ---------------------------------------------------------------------
async function doLocal(medidorId, localId) {
  return db.um(
    `SELECT m.id, m.local_id, m.identificador_esp32, m.capacidade_botijao_kg,
            m.peso_vazio_botijao_kg, m.nome_apelido, m.status, m.intervalo_envio_seg,
            m.token_dispositivo, m.created_at
       FROM tb_medidores m
      WHERE m.id = ? AND m.local_id = ?`,
    [medidorId, localId]
  );
}

// GET /api/medidores/nivel  -> vw_nivel_atual (tela Inicio e Botijoes)
router.get('/nivel', async (req, res) => {
  const linhas = await db.query(
    `SELECT v.medidor_id, v.local_id, v.nome_apelido, v.capacidade_botijao_kg,
            v.peso_vazio_botijao_kg, v.data_hora_leitura, v.peso_total_kg,
            v.gas_restante_kg, v.percentual_restante, v.status_nivel,
            m.status AS status_medidor, m.identificador_esp32, m.intervalo_envio_seg,
            TIMESTAMPDIFF(MINUTE, v.data_hora_leitura, NOW()) AS minutos_sem_leitura
       FROM vw_nivel_atual v
       JOIN tb_medidores m ON m.id = v.medidor_id
      WHERE v.local_id = ?
      ORDER BY v.nome_apelido, v.medidor_id`,
    [req.usuario.local_id]
  );
  res.json(linhas);
});

// GET /api/medidores -> lista completa (com o estado vazio tratado)
router.get('/', async (req, res) => {
  const linhas = await db.query(
    `SELECT m.id, m.identificador_esp32, m.nome_apelido, m.capacidade_botijao_kg,
            m.peso_vazio_botijao_kg, m.status, m.intervalo_envio_seg, m.created_at,
            v.percentual_restante, v.gas_restante_kg, v.status_nivel,
            v.data_hora_leitura, v.peso_total_kg
       FROM tb_medidores m
       LEFT JOIN vw_nivel_atual v ON v.medidor_id = m.id
      WHERE m.local_id = ?
      ORDER BY m.nome_apelido, m.id`,
    [req.usuario.local_id]
  );
  res.json(linhas);
});

// GET /api/medidores/:id/previsao -> vw_previsao_troca (tela Inicio)
router.get('/:id/previsao', async (req, res) => {
  const medidor = await doLocal(req.params.id, req.usuario.local_id);
  if (!medidor) return res.status(404).json({ erro: 'Medidor nao encontrado neste local.' });

  const previsao = await db.um(
    `SELECT medidor_id, nome_apelido, peso_total_kg, gas_restante_kg, percentual_restante,
            status_nivel, media_consumo_dia, dias_estimados_restantes, data_estimada_troca
       FROM vw_previsao_troca WHERE medidor_id = ?`,
    [medidor.id]
  );
  res.json(previsao || { medidor_id: medidor.id, nome_apelido: medidor.nome_apelido });
});

// GET /api/medidores/:id/consumo?de=&ate=  -> tb_consumo_diario (Historico)
router.get('/:id/consumo', async (req, res) => {
  const medidor = await doLocal(req.params.id, req.usuario.local_id);
  if (!medidor) return res.status(404).json({ erro: 'Medidor nao encontrado neste local.' });

  const de = (req.query.de || '').slice(0, 10) || null;
  const ate = (req.query.ate || '').slice(0, 10) || null;

  const linhas = await db.query(
    `SELECT data, peso_inicio_dia_kg, peso_fim_dia_kg, consumo_kg, dia_util
       FROM tb_consumo_diario
      WHERE medidor_id = ?
        AND (? IS NULL OR data >= ?)
        AND (? IS NULL OR data <= ?)
      ORDER BY data`,
    [medidor.id, de, de, ate, ate]
  );
  res.json(linhas);
});

// GET /api/medidores/:id/trocas
router.get('/:id/trocas', async (req, res) => {
  const medidor = await doLocal(req.params.id, req.usuario.local_id);
  if (!medidor) return res.status(404).json({ erro: 'Medidor nao encontrado neste local.' });

  const linhas = await db.query(
    `SELECT id, medidor_id, data_hora, peso_botijao_novo_kg, tara_botijao_kg
       FROM tb_trocas_botijao WHERE medidor_id = ? ORDER BY data_hora DESC`,
    [medidor.id]
  );
  res.json(linhas);
});

// POST /api/medidores/:id/trocas  -> INSERT em tb_trocas_botijao (tela Trocar)
router.post('/:id/trocas', async (req, res) => {
  const medidor = await doLocal(req.params.id, req.usuario.local_id);
  if (!medidor) return res.status(404).json({ erro: 'Medidor nao encontrado neste local.' });

  const pesoNovo = Number(req.body && req.body.peso_botijao_novo_kg);
  const tara = req.body && req.body.tara_botijao_kg !== undefined && req.body.tara_botijao_kg !== null && req.body.tara_botijao_kg !== ''
    ? Number(req.body.tara_botijao_kg)
    : null;
  const quando = req.body && req.body.data_hora ? String(req.body.data_hora).replace('T', ' ').slice(0, 19) : null;

  if (!Number.isFinite(pesoNovo) || pesoNovo < 0) {
    return res.status(400).json({ erro: 'Informe o peso total do botijao novo em kg (>= 0).' });
  }
  if (tara !== null && (!Number.isFinite(tara) || tara < 0)) {
    return res.status(400).json({ erro: 'Tara invalida: use um valor em kg (>= 0) ou deixe em branco.' });
  }
  // Mesma validacao do recebimento de leitura: um peso absurdo nao passa.
  const teto = medidor.capacidade_botijao_kg + (tara === null ? medidor.peso_vazio_botijao_kg : tara) + 1;
  if (pesoNovo > teto) {
    return res.status(422).json({
      erro: `Peso recusado: ${pesoNovo} kg passa do teto do medidor (${teto.toFixed(2)} kg = capacidade + tara + margem).`,
    });
  }

  try {
    const r = await db.query(
      `INSERT INTO tb_trocas_botijao (medidor_id, data_hora, peso_botijao_novo_kg, tara_botijao_kg)
       VALUES (?, COALESCE(?, NOW()), ?, ?)`,
      [medidor.id, quando, pesoNovo, tara]
    );
    // A troca em si tambem e uma leitura: mantem o nivel coerente na hora.
    await db.query(
      `INSERT INTO tb_leituras (medidor_id, data_hora, peso_total_kg)
       VALUES (?, COALESCE(?, NOW()), ?)
       ON DUPLICATE KEY UPDATE peso_total_kg = VALUES(peso_total_kg)`,
      [medidor.id, quando, pesoNovo]
    );
    const nivel = await db.um(
      `SELECT medidor_id, percentual_restante, gas_restante_kg, status_nivel, data_hora_leitura
         FROM vw_nivel_atual WHERE medidor_id = ?`,
      [medidor.id]
    );
    return res.status(201).json({ ok: true, troca_id: r.insertId, nivel });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Ja existe uma troca registrada nesse mesmo instante.' });
    }
    throw e;
  }
});

// GET /api/medidores/relatorios/consumo-mensal (Fase 7, direto do OLTP)
router.get('/relatorios/consumo-mensal', async (req, res) => {
  const linhas = await db.query(
    `SELECT DATE_FORMAT(c.data, '%Y-%m') AS mes,
            l.tipo_local,
            ROUND(SUM(c.consumo_kg), 2) AS consumo_total_kg,
            COUNT(*)                    AS dias_medidos
       FROM tb_consumo_diario c
       JOIN tb_medidores m ON m.id = c.medidor_id
       JOIN tb_locais l    ON l.id = m.local_id
      WHERE m.local_id = ? AND c.consumo_kg IS NOT NULL
      GROUP BY mes, l.tipo_local
      ORDER BY mes DESC`,
    [req.usuario.local_id]
  );
  res.json(linhas);
});

module.exports = router;