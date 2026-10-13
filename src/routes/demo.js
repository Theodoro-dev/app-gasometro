'use strict';

// ---------------------------------------------------------------------
// Rotas de demonstracao (DEMO_MODE=true).
// Existem para o app ser testavel de ponta a ponta sem o ESP32 na mao:
// geram leituras como o hardware geraria e chamam as procedures do banco.
// ---------------------------------------------------------------------

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');

const router = express.Router();

router.use((req, res, next) => {
  if (!config.demo) return res.status(404).json({ erro: 'Modo demonstracao desativado (DEMO_MODE=false).' });
  return next();
});
router.use(auth.exigirLogin);

const fmtDia = (d) => d.toISOString().slice(0, 10);

/**
 * POST /api/demo/simular
 * body: { dias = 14, consumo_dia_kg = 1.0, incluir_anomalia = true }
 * Gera o historico de leituras (duas ou tres por dia) para cada medidor do
 * local, recalcula o consumo e os alertas com as procedures do banco.
 */
router.post('/simular', async (req, res) => {
  const dias = Math.min(Math.max(parseInt((req.body && req.body.dias) || 14, 10) || 14, 2), 60);
  const consumoDia = Number((req.body && req.body.consumo_dia_kg) || 1.0);
  const incluirAnomalia = !req.body || req.body.incluir_anomalia !== false;

  const medidores = await db.query(
    `SELECT id, nome_apelido, capacidade_botijao_kg, peso_vazio_botijao_kg
       FROM tb_medidores WHERE local_id = ? ORDER BY id`,
    [req.usuario.local_id]
  );
  if (medidores.length === 0) {
    return res.status(400).json({ erro: 'Cadastre ao menos um medidor antes de simular.' });
  }

  const resumo = [];
  for (const [i, m] of medidores.entries()) {
    // Cada medidor comeca "cheio" (tara + capacidade) e vai consumindo.
    let peso = Number(m.capacidade_botijao_kg) + Number(m.peso_vazio_botijao_kg);
    const pesoMinimo = Number(m.peso_vazio_botijao_kg);

    // Apaga o historico antigo deste medidor para o teste ser repetivel.
    await db.query(`DELETE FROM tb_leituras WHERE medidor_id = ?`, [m.id]);
    await db.query(`DELETE FROM tb_consumo_diario WHERE medidor_id = ?`, [m.id]);
    await db.query(`DELETE FROM tb_trocas_botijao WHERE medidor_id = ?`, [m.id]);

    const hoje = new Date();
    const leituras = [];
    for (let d = dias; d >= 0; d -= 1) {
      const dia = new Date(hoje.getTime());
      dia.setDate(dia.getDate() - d);
      const data = fmtDia(dia);

      // Dia tipico: 3 leituras. A cada 5 dias o medidor recebe um botijao novo.
      const horas = d === 0 ? ['06:00:00', '12:00:00'] : ['06:00:00', '12:00:00', '21:00:00'];
      const trocaHoje = d > 0 && d % 7 === 0;

      // Anomalia de consumo: um dia com o triplo da media, para o alerta nascer.
      const fator = incluirAnomalia && d === 2 && i % 2 === 0 ? 3 : 1;
      const consumoDoDia = consumoDia * fator * (0.9 + Math.random() * 0.2);

      if (trocaHoje && d > 0) {
        // Troca ao meio-dia: enche de novo e registra a troca.
        leituras.push([m.id, `${data} 12:00:00`, Number((pesoMinimo + Number(m.capacidade_botijao_kg)).toFixed(2))]);
        await db.query(
          `INSERT INTO tb_trocas_botijao (medidor_id, data_hora, peso_botijao_novo_kg, tara_botijao_kg)
           VALUES (?, ?, ?, ?)`,
          [m.id, `${data} 12:00:00`, Number(m.capacidade_botijao_kg) + pesoMinimo, m.peso_vazio_botijao_kg]
        );
        peso = Number(m.capacidade_botijao_kg) + pesoMinimo;
        continue;
      }

      const passo = consumoDoDia / horas.length;
      for (const h of horas) {
        peso = Math.max(pesoMinimo, peso - passo);
        leituras.push([m.id, `${data} ${h}`, Number(peso.toFixed(2))]);
      }
    }

    for (const [medidorId, dataHora, pesoKg] of leituras) {
      await db.query(
        `INSERT INTO tb_leituras (medidor_id, data_hora, peso_total_kg) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE peso_total_kg = VALUES(peso_total_kg)`,
        [medidorId, dataHora, pesoKg]
      );
    }

    resumo.push({
      medidor_id: m.id,
      nome_apelido: m.nome_apelido,
      leituras: leituras.length,
      peso_final_kg: Number(peso.toFixed(2)),
    });
  }

  // Reprocessa o periodo com as procedures do banco (nada de recalcular aqui).
  await db.procedimento('sp_reprocessar_periodo', [
    fmtDia(new Date(Date.now() - dias * 86400000)),
    fmtDia(new Date(Date.now() - 86400000)),
  ]);
  await db.procedimento('sp_calcular_consumo_diario', [fmtDia(new Date())]);
  await db.procedimento('sp_atualizar_status_medidores', [config.regras.horasOffline]);

  const alertas = await db.query(
    `SELECT a.id, a.tipo, a.data_referencia, m.nome_apelido
       FROM tb_alertas a JOIN tb_medidores m ON m.id = a.medidor_id
      WHERE m.local_id = ? ORDER BY a.data_referencia DESC, a.id DESC`,
    [req.usuario.local_id]
  );
  return res.json({ ok: true, dias_simulados: dias, medidores: resumo, alertas });
});

/**
 * POST /api/demo/consumo-anormal  { medidor_id }
 * Forca um dia de consumo 3x acima da media (ontem) e gera o alerta agora.
 */
router.post('/consumo-anormal', async (req, res) => {
  const medidorId = Number(req.body && req.body.medidor_id);
  const medidor = await db.um(
    `SELECT m.id, m.nome_apelido, m.capacidade_botijao_kg, m.peso_vazio_botijao_kg,
            (SELECT AVG(consumo_kg) FROM tb_consumo_diario
              WHERE medidor_id = m.id AND consumo_kg IS NOT NULL
                AND data >= CURDATE() - INTERVAL 8 DAY AND data < CURDATE()) AS media
       FROM tb_medidores m WHERE m.id = ? AND m.local_id = ?`,
    [medidorId, req.usuario.local_id]
  );
  if (!medidor) return res.status(404).json({ erro: 'Medidor nao encontrado neste local.' });

  const media = Number(medidor.media || 0) || 1.0;
  const consumo = Number((media * 3).toFixed(2));
  const ontem = fmtDia(new Date(Date.now() - 86400000));

  // Sobrescreve o consumo de ontem e deixa as leituras coerentes com ele.
  await db.query(
    `UPDATE tb_consumo_diario SET consumo_kg = ? WHERE medidor_id = ? AND data = ?`,
    [consumo, medidor.id, ontem]
  );
  await db.procedimento('sp_gerar_alertas', [ontem]);

  const alerta = await db.um(
    `SELECT id, tipo, data_referencia FROM tb_alertas
      WHERE medidor_id = ? AND data_referencia = ?`,
    [medidor.id, ontem]
  );
  res.json({ ok: true, medidor_id: medidor.id, nome_apelido: medidor.nome_apelido, media, consumo_kg: consumo, alerta });
});

/**
 * POST /api/demo/limpar -> zera leituras, consumo, alertas e avisos do local.
 */
router.post('/limpar', async (req, res) => {
  const localId = req.usuario.local_id;
  await db.query(
    `DELETE ne FROM tb_notificacoes_enviadas ne
       JOIN tb_alertas a ON a.id = ne.alerta_id
       JOIN tb_medidores m ON m.id = a.medidor_id WHERE m.local_id = ?`, [localId]);
  await db.query(
    `DELETE f FROM tb_whatsapp_fila f
       JOIN tb_alertas a ON a.id = f.alerta_id
       JOIN tb_medidores m ON m.id = a.medidor_id WHERE m.local_id = ?`, [localId]);
  await db.query(
    `DELETE a FROM tb_alertas a JOIN tb_medidores m ON m.id = a.medidor_id WHERE m.local_id = ?`, [localId]);
  await db.query(
    `DELETE c FROM tb_consumo_diario c JOIN tb_medidores m ON m.id = c.medidor_id WHERE m.local_id = ?`, [localId]);
  await db.query(
    `DELETE t FROM tb_trocas_botijao t JOIN tb_medidores m ON m.id = t.medidor_id WHERE m.local_id = ?`, [localId]);
  await db.query(
    `DELETE l FROM tb_leituras l JOIN tb_medidores m ON m.id = l.medidor_id WHERE m.local_id = ?`, [localId]);
  res.json({ ok: true });
});

module.exports = router;