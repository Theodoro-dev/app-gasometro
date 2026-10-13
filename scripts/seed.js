'use strict';

// ---------------------------------------------------------------------
// seed.js - cadastro inicial do app.
//   npm run seed
// Cria o local, o usuario de demonstracao, os medidores (botijoes P13) e o
// canal de WhatsApp. Rodar de novo nao duplica nada.
// ---------------------------------------------------------------------

const crypto = require('crypto');
const db = require('../src/db');
const config = require('../src/config');
const auth = require('../src/auth');

const LOCAL = { nome: 'Casa do Bruno', tipo: 'RESIDENCIAL' };

// Botijao P13: 13 kg de gas + 13 kg de tara = 26 kg cheio.
const MEDIDORES = [
  { identificador: 'ESP32-01', apelido: 'Botijao da cozinha', capacidade: 13.0, tara: 13.0 },
  { identificador: 'ESP32-02', apelido: 'Botijao da churrasqueira', capacidade: 13.0, tara: 13.0 },
  { identificador: 'ESP32-03', apelido: 'Botijao da area de servico', capacidade: 13.0, tara: 13.0 },
];

const USUARIO = {
  email: 'demo@gasometro.app',
  senha: 'gasometro123',
  whatsapp: '+5511999999999', // troque pelo seu numero na tela WhatsApp/Canais
};

async function principal() {
  console.log('== Seed do Gasometro ==');

  // 1) Local
  let local = await db.um(`SELECT id FROM tb_locais WHERE nome_local = ?`, [LOCAL.nome]);
  if (!local) {
    const r = await db.query(
      `INSERT INTO tb_locais (nome_local, tipo_local) VALUES (?, ?)`, [LOCAL.nome, LOCAL.tipo]
    );
    local = { id: r.insertId };
    console.log(`   local criado: ${LOCAL.nome} (#${local.id})`);
  } else {
    console.log(`   local ja existia: ${LOCAL.nome} (#${local.id})`);
  }

  // 2) Usuario
  let usuario = await db.um(`SELECT id FROM tb_usuarios WHERE email = ?`, [USUARIO.email]);
  if (!usuario) {
    const hash = await auth.hashSenha(USUARIO.senha);
    const r = await db.query(
      `INSERT INTO tb_usuarios (local_id, email, senha_hash) VALUES (?, ?, ?)`,
      [local.id, USUARIO.email, hash]
    );
    usuario = { id: r.insertId };
    console.log(`   usuario criado: ${USUARIO.email} (senha: ${USUARIO.senha})`);
  } else {
    console.log(`   usuario ja existia: ${USUARIO.email}`);
  }

  // 3) Medidores + token de dispositivo
  for (const m of MEDIDORES) {
    const existente = await db.um(
      `SELECT id, token_dispositivo FROM tb_medidores WHERE identificador_esp32 = ?`, [m.identificador]
    );
    const token = crypto.randomBytes(16).toString('hex');
    if (existente) {
      await db.query(
        `UPDATE tb_medidores SET nome_apelido = ?, capacidade_botijao_kg = ?, peso_vazio_botijao_kg = ?,
                                 token_dispositivo = COALESCE(token_dispositivo, ?)
          WHERE id = ?`,
        [m.apelido, m.capacidade, m.tara, token, existente.id]
      );
      console.log(`   medidor ok: ${m.identificador} (${m.apelido})`);
    } else {
      await db.query(
        `INSERT INTO tb_medidores
            (local_id, identificador_esp32, capacidade_botijao_kg, peso_vazio_botijao_kg,
             nome_apelido, token_dispositivo, intervalo_envio_seg)
         VALUES (?, ?, ?, ?, ?, ?, 300)`,
        [local.id, m.identificador, m.capacidade, m.tara, m.apelido, token]
      );
      console.log(`   medidor criado: ${m.identificador} (${m.apelido})`);
    }
  }

  // 4) Canal de WhatsApp do usuario
  const canal = await db.um(
    `SELECT id FROM tb_canais_notificacao WHERE usuario_id = ? AND tipo = 'WHATSAPP' AND destino = ?`,
    [usuario.id, USUARIO.whatsapp]
  );
  if (!canal) {
    await db.query(
      `INSERT INTO tb_canais_notificacao (usuario_id, tipo, destino, ativo) VALUES (?, 'WHATSAPP', ?, TRUE)`,
      [usuario.id, USUARIO.whatsapp]
    );
    console.log(`   canal WhatsApp criado: ${USUARIO.whatsapp}`);
  } else {
    console.log(`   canal WhatsApp ja existia: ${USUARIO.whatsapp}`);
  }

  // 5) Resumo
  const medidores = await db.query(
    `SELECT identificador_esp32, nome_apelido, token_dispositivo FROM tb_medidores WHERE local_id = ?`,
    [local.id]
  );
  console.log('\n== Tokens para gravar no firmware do ESP32 ==');
  for (const m of medidores) {
    console.log(`   ${m.identificador_esp32.padEnd(10)} token: ${m.token_dispositivo}`);
  }
  console.log(`\nLogin no app: ${USUARIO.email} / ${USUARIO.senha}`);
  console.log(`Canal de aviso configurado: ${config.whatsapp.provedor}`);
  process.exit(0);
}

principal().catch((e) => {
  console.error('Falha no seed:', e.message);
  process.exit(1);
});