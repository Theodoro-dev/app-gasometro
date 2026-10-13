'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

function gerarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, local_id: usuario.local_id, email: usuario.email },
    config.jwt.segredo,
    { expiresIn: config.jwt.validade }
  );
}

// Middleware: exige um Bearer token valido e injeta req.usuario.
function exigirLogin(req, res, next) {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) {
    return res.status(401).json({ erro: 'Token ausente. Faca login.' });
  }
  try {
    const dados = jwt.verify(token, config.jwt.segredo);
    req.usuario = { id: dados.sub, local_id: dados.local_id, email: dados.email };
    return next();
  } catch (e) {
    return res.status(401).json({ erro: 'Token invalido ou expirado.' });
  }
}

async function login(email, senha) {
  const usuario = await db.um(
    `SELECT u.id, u.local_id, u.email, u.senha_hash, l.nome_local, l.tipo_local
       FROM tb_usuarios u
       JOIN tb_locais l ON l.id = u.local_id
      WHERE u.email = ?`,
    [email]
  );
  if (!usuario) return null;
  const confere = await bcrypt.compare(senha, usuario.senha_hash);
  if (!confere) return null;

  return {
    token: gerarToken(usuario),
    usuario: {
      id: usuario.id,
      email: usuario.email,
      local_id: usuario.local_id,
      nome_local: usuario.nome_local,
      tipo_local: usuario.tipo_local,
    },
  };
}

module.exports = { login, exigirLogin, gerarToken, hashSenha: (s) => bcrypt.hash(s, 10) };