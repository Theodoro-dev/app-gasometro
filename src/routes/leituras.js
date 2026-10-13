'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');

const router = express.Router();

// ---------------------------------------------------------------------
// POST /api/leituras  - o ESP32 manda o peso lido pela celula de carga.
// Autenticacao do dispositivo: cabecalho X-Device-Token.
// O guia e explicito: o banco nao valida peso absurdo (um CHECK nao cruza
// tabelas), entao a validacao de faixa fica aqui, no recebimento (Fase 3).
// ---------------------------------------------------------------------
router.post('/leituras', async (req, res) => {
  const corpo = req.body || {};
  const identificador = String(corpo.identificador_esp32 || corpo.identificador || '').trim();
  const token = String(req.headers['x-device-token'] || corpo.token || '').trim();
  const peso = Number(corpo.peso_total_kg !== undefined ? corpo.peso_total_kg : corpo.peso);
  const quando = corpo.data_hora ? String(corpo.data_hora).replace('T', ' ').slice(0, 19) : null;

  if (!identificador) {
    return res.status(400).json({ erro: 'Informe identificador_esp32.' });
  }
  if (!Number.isFinite(peso) || peso < 0) {
    return res.status(400).json({ erro: 'peso_total_kg ausente, invalido ou negativo.' });
  }

  const medidor = await db.um(
    `SELECT m.id, m.local_id, m.identificador_esp32, m.capacidade_botijao_kg,
            m.peso_vazio_botijao_kg, m.token_dispositivo, m.status,
            (SELECT t.tara_botijao_kg FROM tb_trocas_botijao t
              WHERE t.medidor_id = m.id AND t.tara_botijao_kg IS NOT NULL
              ORDER BY t.data_hora DESC LIMIT 1) AS tara_troca
       FROM tb_medidores m
      WHERE m.identificador_esp32 = ?`,
    [identificador]
  );
  if (!medidor) return res.status(404).json({ erro: `Medidor "${identificador}" nao cadastrado.` });
  if (medidor.status === 'INATIVO') return res.status(409).json({ erro: 'Medidor INATIVO: leitura ignorada.' });

  // Token: obrigatorio quando o medidor tem um token configurado.
  if (medidor.token_dispositivo) {
    const esperado = Buffer.from(medidor.token_dispositivo);
    const enviado = Buffer.from(token);
    const ok = esperado.length === enviado.length && crypto.timingSafeEqual(esperado, enviado);
    if (!ok) return res.status(401).json({ erro: 'Token do dispositivo invalido.' });
  }

  const tara = medidor.tara_troca !== null && medidor.tara_troca !== undefined
    ? Number(medidor.tara_troca)
    : Number(medidor.peso_vazio_botijao_kg);
  const teto = Number(medidor.capacidade_botijao_kg) + tara + config.regras.margemLeituraKg;

  if (peso > teto) {
    return res.status(422).json({
      erro: `Leitura recusada: ${peso} kg acima do teto de ${teto.toFixed(2)} kg ` +
            `(capacidade ${medidor.capacidade_botijao_kg} + tara ${tara} + margem ${config.regras.margemLeituraKg}).`,
      teto_kg: Number(teto.toFixed(2)),
    });
  }

  try {
    const r = await db.query(
      `INSERT INTO tb_leituras (medidor_id, data_hora, peso_total_kg)
       VALUES (?, COALESCE(?, NOW()), ?)
       ON DUPLICATE KEY UPDATE peso_total_kg = VALUES(peso_total_kg)`,
      [medidor.id, quando, peso]
    );
    const nivel = await db.um(
      `SELECT medidor_id, percentual_restante, gas_restante_kg, status_nivel, data_hora_leitura
         FROM vw_nivel_atual WHERE medidor_id = ?`,
      [medidor.id]
    );
    return res.status(201).json({ ok: true, leitura_id: r.insertId || null, nivel });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Ja existe leitura deste medidor nesse instante.' });
    }
    throw e;
  }
});

// ---------------------------------------------------------------------
// Rotas administrativas (exigem login)
// ---------------------------------------------------------------------
router.use(auth.exigirLogin);

// GET /api/dispositivos -> dados para gravar no firmware
router.get('/dispositivos', async (req, res) => {
  const linhas = await db.query(
    `SELECT id, identificador_esp32, nome_apelido, status, intervalo_envio_seg,
            CASE WHEN token_dispositivo IS NULL THEN FALSE ELSE TRUE END AS tem_token
       FROM tb_medidores WHERE local_id = ? ORDER BY id`,
    [req.usuario.local_id]
  );
  res.json(linhas);
});

// POST /api/dispositivos/:id/token -> gera (ou troca) o token do ESP32
router.post('/dispositivos/:id/token', async (req, res) => {
  const medidor = await db.um(
    `SELECT id FROM tb_medidores WHERE id = ? AND local_id = ?`,
    [req.params.id, req.usuario.local_id]
  );
  if (!medidor) return res.status(404).json({ erro: 'Medidor nao encontrado neste local.' });

  const token = crypto.randomBytes(16).toString('hex');
  await db.query(`UPDATE tb_medidores SET token_dispositivo = ? WHERE id = ?`, [token, medidor.id]);
  res.json({ ok: true, medidor_id: medidor.id, token });
});

// POST /api/calibracoes  { medidor_id, peso_referencia_kg }
router.post('/calibracoes', async (req, res) => {
  const medidorId = Number(req.body && req.body.medidor_id);
  const peso = Number(req.body && req.body.peso_referencia_kg);
  if (!Number.isFinite(medidorId) || !Number.isFinite(peso) || peso < 0) {
    return res.status(400).json({ erro: 'Informe medidor_id e peso_referencia_kg (>= 0).' });
  }
  const medidor = await db.um(
    `SELECT id FROM tb_medidores WHERE id = ? AND local_id = ?`, [medidorId, req.usuario.local_id]
  );
  if (!medidor) return res.status(404).json({ erro: 'Medidor nao encontrado neste local.' });

  await db.query(
    `INSERT INTO tb_calibracoes (medidor_id, peso_referencia_kg) VALUES (?, ?)`,
    [medidor.id, peso]
  );
  res.status(201).json({ ok: true });
});

module.exports = router;