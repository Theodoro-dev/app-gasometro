'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();
router.use(auth.exigirLogin);

// GET /api/alertas?limite=&de=&ate=&tipo=  (telas Inicio e Historico)
router.get('/', async (req, res) => {
  const limite = Math.min(parseInt(req.query.limite || '30', 10) || 30, 200);
  const de = (req.query.de || '').slice(0, 10) || null;
  const ate = (req.query.ate || '').slice(0, 10) || null;
  const tipo = ['AMARELO', 'VERMELHO'].includes(req.query.tipo) ? req.query.tipo : null;

  const linhas = await db.query(
    `SELECT a.id, a.medidor_id, a.tipo, a.data_referencia, a.data_hora,
            m.nome_apelido, m.identificador_esp32,
            cd.consumo_kg, md.media_consumo_dia,
            n.percentual_restante, n.status_nivel,
            (SELECT COUNT(*) FROM tb_notificacoes_enviadas ne WHERE ne.alerta_id = a.id) AS avisos_enviados
       FROM tb_alertas a
       JOIN tb_medidores m ON m.id = a.medidor_id
       LEFT JOIN tb_consumo_diario cd ON cd.medidor_id = a.medidor_id AND cd.data = a.data_referencia
       LEFT JOIN vw_media_consumo md  ON md.medidor_id = a.medidor_id
       LEFT JOIN vw_nivel_atual n     ON n.medidor_id = a.medidor_id
      WHERE m.local_id = ?
        AND (? IS NULL OR a.data_referencia >= ?)
        AND (? IS NULL OR a.data_referencia <= ?)
        AND (? IS NULL OR a.tipo = ?)
      ORDER BY a.data_referencia DESC, a.id DESC
      LIMIT ${limite}`,
    [req.usuario.local_id, de, de, ate, ate, tipo, tipo]
  );
  res.json(linhas);
});

// GET /api/alertas/resumo -> contadores para o cabecalho da tela Inicio
router.get('/resumo', async (req, res) => {
  const r = await db.um(
    `SELECT
        SUM(a.tipo = 'VERMELHO') AS vermelhos_30d,
        SUM(a.tipo = 'AMARELO')  AS amarelos_30d,
        (SELECT COUNT(*) FROM tb_notificacoes_enviadas ne
           JOIN tb_alertas al ON al.id = ne.alerta_id
           JOIN tb_medidores mm ON mm.id = al.medidor_id
          WHERE mm.local_id = ?) AS avisos_enviados
       FROM tb_alertas a
       JOIN tb_medidores m ON m.id = a.medidor_id
      WHERE m.local_id = ? AND a.data_referencia >= CURDATE() - INTERVAL 30 DAY`,
    [req.usuario.local_id, req.usuario.local_id]
  );
  res.json(r || { vermelhos_30d: 0, amarelos_30d: 0, avisos_enviados: 0 });
});

module.exports = router;