'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

// Pool unico compartilhado por toda a API. O app nunca fala com o MySQL
// diretamente: a senha do banco fica so aqui, no servidor (Fase 4 do guia).
const pool = mysql.createPool({
  host: config.banco.host,
  port: config.banco.porta,
  user: config.banco.usuario,
  password: config.banco.senha,
  database: config.banco.database,
  waitForConnections: true,
  connectionLimit: config.banco.connectionLimit,
  queueLimit: 0,
  timezone: '-03:00',
  dateStrings: ['DATE'],
  decimalNumbers: true,
  charset: 'utf8mb4_0900_ai_ci',
});

async function query(sql, params = []) {
  const [linhas] = await pool.execute(sql, params);
  return linhas;
}

async function um(sql, params = []) {
  const linhas = await query(sql, params);
  return linhas[0] || null;
}

async function procedimento(nome, params = []) {
  const marcadores = params.map(() => '?').join(', ');
  await pool.query(`CALL ${nome}(${marcadores})`, params);
}

async function testarConexao() {
  const conn = await pool.getConnection();
  try {
    const [r] = await conn.query(
      'SELECT DATABASE() AS banco, @@global.time_zone AS fuso, @@global.event_scheduler AS scheduler'
    );
    return r[0];
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, um, procedimento, testarConexao };