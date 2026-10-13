'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ erro: 'Informe email e senha.' });
  }
  const sessao = await auth.login(String(email).trim().toLowerCase(), String(senha));
  if (!sessao) return res.status(401).json({ erro: 'Email ou senha invalidos.' });
  return res.json(sessao);
});

// GET /api/auth/eu
router.get('/eu', auth.exigirLogin, async (req, res) => {
  const usuario = await db.um(
    `SELECT u.id, u.email, u.local_id, l.nome_local, l.tipo_local
       FROM tb_usuarios u JOIN tb_locais l ON l.id = u.local_id
      WHERE u.id = ?`,
    [req.usuario.id]
  );
  if (!usuario) return res.status(404).json({ erro: 'Usuario nao encontrado.' });
  return res.json(usuario);
});

module.exports = router;