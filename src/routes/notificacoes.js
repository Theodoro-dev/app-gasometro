'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const notificacoes = require('../services/notificacoes');
const wa = require('../services/whatsapp');
const config = require('../config');

const router = express.Router();
router.use(auth.exigirLogin);

// GET /api/notificacoes -> historico de avisos do local
router.get('/', async (req, res) => {
  const limite = Math.min(parseInt(req.query.limite || '50', 10) || 50, 200);
  const linhas = await db.query(
    `SELECT ne.id, ne.status, ne.provedor, ne.modo, ne.data_hora_envio, ne.link_whatsapp, ne.erro,
            ne.tentativas, ne.mensagem,
            a.tipo, a.data_referencia, m.nome_apelido, c.tipo AS canal, c.destino
       FROM tb_notificacoes_enviadas ne
       JOIN tb_alertas a   ON a.id = ne.alerta_id
       JOIN tb_medidores m ON m.id = a.medidor_id
       JOIN tb_canais_notificacao c ON c.id = ne.canal_id
      WHERE m.local_id = ?
      ORDER BY ne.data_hora_envio DESC
      LIMIT ${limite}`,
    [req.usuario.local_id]
  );
  res.json({
    provedor: wa.provedorAtivo(),
    modo_real: wa.provedorAtivo() !== 'simulado',
    envios: linhas,
  });
});

// GET /api/notificacoes/pendentes -> a consulta do guia, escopada ao local
router.get('/pendentes', async (req, res) => {
  const linhas = await db.query(
    `SELECT a.id AS alerta_id, a.tipo, a.data_referencia, m.nome_apelido,
            c.id AS canal_id, c.tipo AS canal, c.destino
       FROM tb_alertas a
       JOIN tb_medidores m          ON m.id = a.medidor_id
       JOIN tb_usuarios u           ON u.local_id = m.local_id
       JOIN tb_canais_notificacao c ON c.usuario_id = u.id AND c.ativo = TRUE
      WHERE m.local_id = ?
        AND NOT EXISTS (
            SELECT 1 FROM tb_notificacoes_enviadas n
             WHERE n.alerta_id = a.id AND n.canal_id = c.id)
      ORDER BY a.data_referencia DESC`,
    [req.usuario.local_id]
  );
  res.json(linhas);
});

// POST /api/notificacoes/processar -> roda a varredura agora (mesma do worker)
router.post('/processar', async (req, res) => {
  const resumo = await notificacoes.processarPendentes({ limite: 200 });
  res.json({ ok: true, provedor: wa.provedorAtivo(), modo_real: wa.provedorAtivo() !== 'simulado', ...resumo });
});

// GET /api/notificacoes/worker -> estado do worker
router.get('/worker', async (req, res) => {
  res.json({
    ativo: config.notificacoes.ativo,
    intervalo_seg: config.notificacoes.intervaloSeg,
    max_tentativas: config.notificacoes.maxTentativas,
    provedor: wa.provedorAtivo(),
  });
});

module.exports = router;