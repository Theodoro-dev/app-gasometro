'use strict';

// ---------------------------------------------------------------------
// simulador_esp32.js - faz o papel do hardware (Fase 3 do guia).
// Le um "peso" da celula de carga simulada e envia para POST /api/leituras,
// do mesmo jeito que o ESP32 faria. Serve para testar sem o botijao na mesa.
//
// Uso:
//   node scripts/simulador_esp32.js --medidor ESP32-01 --token <token> --residencial
//   node scripts/simulador_esp32.js --medidor ESP32-01 --token <t> --loop --intervalo 30
//   node scripts/simulador_esp32.js --url http://127.0.0.1:3000
//
// Sem --token ele consulta o token no banco (uso local apenas).
// ---------------------------------------------------------------------

const db = require('../src/db');
const config = require('../src/config');

function args() {
  const a = process.argv.slice(2);
  const o = { intervalo: 10, loop: false, capacidade: 13, tara: 13, peso: null };
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    if (k === '--loop') o.loop = true;
    else if (k === '--medidor') o.medidor = a[++i];
    else if (k === '--token') o.token = a[++i];
    else if (k === '--url') o.url = a[++i];
    else if (k === '--intervalo') o.intervalo = parseInt(a[++i], 10);
    else if (k === '--capacidade') o.capacidade = Number(a[++i]);
    else if (k === '--tara') o.tara = Number(a[++i]);
    else if (k === '--peso') o.peso = Number(a[++i]);
    else if (k === '--consumo-dia') o.consumoDia = Number(a[++i]);
  }
  o.url = o.url || process.env.API_URL || `http://127.0.0.1:${config.porta}`;
  o.medidor = o.medidor || 'ESP32-01';
  o.consumoDia = o.consumoDia || 1.0;
  return o;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function descobrirToken(identificador) {
  const m = await db.um(
    `SELECT token_dispositivo, capacidade_botijao_kg, peso_vazio_botijao_kg FROM tb_medidores
      WHERE identificador_esp32 = ?`, [identificador]
  );
  if (!m) throw new Error(`medidor ${identificador} nao esta no banco`);
  return {
    token: m.token_dispositivo || '',
    capacidade: Number(m.capacidade_botijao_kg),
    tara: Number(m.peso_vazio_botijao_kg),
  };
}

async function enviar(opcoes, peso) {
  const corpo = { identificador_esp32: opcoes.medidor, peso_total_kg: Number(peso.toFixed(2)) };
  const resposta = await fetch(`${opcoes.url}/api/leituras`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': opcoes.token || '' },
    body: JSON.stringify(corpo),
  });
  const json = await resposta.json().catch(() => ({}));
  const hora = new Date().toLocaleTimeString('pt-BR');
  if (resposta.ok) {
    const n = json.nivel || {};
    console.log(
      `[${hora}] ${opcoes.medidor} -> ${corpo.peso_total_kg} kg | ` +
      `nivel ${n.percentual_restante ?? '--'}% (${n.status_nivel || '--'}) | ` +
      `gas ${n.gas_restante_kg ?? '--'} kg`
    );
  } else {
    console.log(`[${hora}] ${opcoes.medidor} -> recusado (${resposta.status}): ${json.erro}`);
  }
  return json;
}

async function principal() {
  const o = args();
  if (!o.token) {
    const d = await descobrirToken(o.medidor);
    o.token = d.token;
    o.capacidade = d.capacidade || o.capacidade;
    o.tara = d.tara || o.tara;
  }

  let peso = o.peso !== null ? o.peso : o.capacidade + o.tara;
  const pesoVazio = o.tara;
  const passoPorEnvio = (o.consumoDia / 24 / 60) * o.intervalo; // consumo proporcional ao tempo

  console.log(`Simulador do ESP32 -> ${o.url}`);
  console.log(`Medidor ${o.medidor} | botijao cheio = ${(o.capacidade + o.tara).toFixed(2)} kg | tara ${o.tara} kg`);
  console.log(o.loop
    ? `Modo continuo: uma leitura a cada ${o.intervalo}s (Ctrl+C para parar).`
    : 'Enviando uma leitura unica.');

  do {
    await enviar(o, peso);
    if (peso - passoPorEnvio < pesoVazio) {
      peso = o.capacidade + o.tara;
      console.log('   ... botijao vazio: simulando a troca (novo botijao cheio).');
    } else {
      peso -= passoPorEnvio;
    }
    if (o.loop) await dormir(o.intervalo * 1000);
  } while (o.loop);

  process.exit(0);
}

principal().catch((e) => {
  console.error('Simulador falhou:', e.message);
  process.exit(1);
});