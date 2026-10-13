'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const wa = require('../services/whatsapp');
const notificacoes = require('../services/notificacoes');

const router = express.Router();
router.use(auth.exigirLogin);

const TIPOS = ['WHATSAPP', 'PUSH', 'EMAIL', 'SMS'];

function normalizarTelefone(bruto) {
  const digitos = wa.apenasDigitos(bruto);
  if (digitos.length < 10 || digitos.length > 15) return null;
  return `+${digitos}`;
}

// GET /api/canais
router.get('/', async (req, res) => {
  const linhas = await db.query(
    `SELECT id, tipo, destino, ativo FROM tb_canais_notificacao
      WHERE usuario_id = ? ORDER BY tipo, id`,
    [req.usuario.id]
  );
  res.json({
    provedor: wa.provedorAtivo(),
    modo_real: wa.provedorAtivo() !== 'simulado',
    canais: linhas,
  });
});

// POST /api/canais  { tipo: 'WHATSAPP', destino: '+5511999999999' }
router.post('/', async (req, res) => {
  const tipo = String((req.body && req.body.tipo) || 'WHATSAPP').toUpperCase();
  if (!TIPOS.includes(tipo)) {
    return res.status(400).json({ erro: `Tipo invalido. Use um de: ${TIPOS.join(', ')}.` });
  }
  let destino = String((req.body && req.body.destino) || '').trim();
  if (!destino) return res.status(400).json({ erro: 'Informe o destino (numero de WhatsApp).' });

  if (tipo === 'WHATSAPP' || tipo === 'SMS') {
    const normalizado = normalizarTelefone(destino);
    if (!normalizado) {
      return res.status(400).json({
        erro: 'Numero invalido. Use DDI + DDD + numero, somente digitos. Ex.: +5511999999999.',
      });
    }
    destino = normalizado;
  }

  try {
    await db.query(
      `INSERT INTO tb_canais_notificacao (usuario_id, tipo, destino, ativo) VALUES (?, ?, ?, TRUE)`,
      [req.usuario.id, tipo, destino]
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      await db.query(
        `UPDATE tb_canais_notificacao SET ativo = TRUE
          WHERE usuario_id = ? AND tipo = ? AND destino = ?`,
        [req.usuario.id, tipo, destino]
      );
      return res.status(200).json({ ok: true, reativado: true, destino });
    }
    throw e;
  }
  res.status(201).json({ ok: true, tipo, destino });
});

// PATCH /api/canais/:id  { ativo: false }
router.patch('/:id', async (req, res) => {
  const ativo = req.body && req.body.ativo === false ? 0 : 1;
  const r = await db.query(
    `UPDATE tb_canais_notificacao SET ativo = ? WHERE id = ? AND usuario_id = ?`,
    [ativo, req.params.id, req.usuario.id]
  );
  if (r.affectedRows === 0) return res.status(404).json({ erro: 'Canal nao encontrado.' });
  res.json({ ok: true, ativo: !!ativo });
});

// DELETE /api/canais/:id
router.delete('/:id', async (req, res) => {
  const r = await db.query(
    `DELETE FROM tb_canais_notificacao WHERE id = ? AND usuario_id = ?`,
    [req.params.id, req.usuario.id]
  );
  if (r.affectedRows === 0) return res.status(404).json({ erro: 'Canal nao encontrado.' });
  res.json({ ok: true });
});

// POST /api/canais/:id/teste -> manda a mensagem de teste (Fase 6)
router.post('/:id/teste', async (req, res) => {
  const canal = await db.um(
    `SELECT id FROM tb_canais_notificacao WHERE id = ? AND usuario_id = ?`,
    [req.params.id, req.usuario.id]
  );
  if (!canal) return res.status(404).json({ erro: 'Canal nao encontrado.' });

  const r = await notificacoes.enviarTeste(canal.id);
  if (!r.ok) return res.status(502).json({ erro: r.erro || 'Falha no envio.', ...r });
  return res.json({
    ok: true,
    provedor: r.provedor,
    modo: r.modo,
    status: r.status,
    link_whatsapp: r.link_whatsapp,
    mensagem: r.mensagem,
  });
});

module.exports = router;