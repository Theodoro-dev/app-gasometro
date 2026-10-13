'use strict';

// ---------------------------------------------------------------------
// demo_e2e.js - Fase 8 do guia: teste de ponta a ponta pela API.
// Fluxo: saude -> login -> simular 14 dias -> nivel -> alertas ->
//        enviar aviso no WhatsApp -> registrar troca -> conferir recalculo.
// Uso: node scripts/demo_e2e.js   (com o servidor no ar)
// ---------------------------------------------------------------------

const config = require('../src/config');

const BASE = process.env.API_URL || `http://127.0.0.1:${config.porta}`;
const CREDENCIAIS = { email: 'demo@gasometro.app', senha: 'gasometro123' };

let token = null;
let falhas = 0;

function titulo(t) {
  console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);
}

function checar(rotulo, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  [OK]    ${rotulo}${detalhe ? ` - ${detalhe}` : ''}`);
  } else {
    console.log(`  [FALHA] ${rotulo}${detalhe ? ` - ${detalhe}` : ''}`);
    falhas += 1;
  }
}

async function api(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function principal() {
  titulo('1. Saude da API e do banco');
  const saude = await api('GET', '/api/saude');
  checar('GET /api/saude', saude.status === 200, `banco ${saude.json.banco && saude.json.banco.banco}, scheduler=${saude.json.banco && saude.json.banco.scheduler}`);
  checar('canal de aviso configurado', !!saude.json.whatsapp, `provedor=${saude.json.whatsapp && saude.json.whatsapp.provedor}`);

  titulo('2. Login (tb_usuarios com senha em hash)');
  const login = await api('POST', '/api/auth/login', CREDENCIAIS);
  checar('POST /api/auth/login', login.status === 200 && !!login.json.token);
  token = login.json.token;
  checar('usuario amarrado a um local', !!login.json.usuario.local_id, login.json.usuario && login.json.usuario.nome_local);

  titulo('3. Login com senha errada tem que falhar');
  const errado = await api('POST', '/api/auth/login', { ...CREDENCIAIS, senha: 'chute' });
  checar('senha errada recusada', errado.status === 401, `HTTP ${errado.status}`);

  titulo('4. Sem token nao se ve nada');
  const semToken = await fetch(`${BASE}/api/medidores/nivel`);
  checar('GET /api/medidores/nivel sem Bearer', semToken.status === 401, `HTTP ${semToken.status}`);

  titulo('5. Simulando 14 dias de leituras do ESP32 + reprocessamento no banco');
  const sim = await api('POST', '/api/demo/simular', { dias: 14, consumo_dia_kg: 1.0, incluir_anomalia: true });
  checar('POST /api/demo/simular', sim.status === 200 && sim.json.ok, `${sim.json.medidores && sim.json.medidores.length} medidor(es), ${sim.json.medidores && sim.json.medidores.reduce((s, m) => s + m.leituras, 0)} leituras`);

  titulo('6. Nivel atual (vw_nivel_atual)');
  const nivel = await api('GET', '/api/medidores/nivel');
  checar('GET /api/medidores/nivel', nivel.status === 200 && nivel.json.length > 0);
  for (const m of nivel.json) {
    console.log(`  ${String(m.nome_apelido).padEnd(30)} ${String(m.percentual_restante).padStart(3)}%  ` +
                `${String(m.status_nivel).padEnd(8)} ${String(m.status_medidor).padEnd(8)} ` +
                `gas ${m.gas_restante_kg} kg`);
  }

  titulo('7. Previsao de troca (vw_previsao_troca)');
  const id = nivel.json[0].medidor_id;
  const prev = await api('GET', `/api/medidores/${id}/previsao`);
  checar('GET /api/medidores/:id/previsao', prev.status === 200);
  console.log(`  ${prev.json.nome_apelido}: media ${prev.json.media_consumo_dia} kg/dia, ` +
              `${prev.json.dias_estimados_restantes} dias, troca em ${prev.json.data_estimada_troca}`);

  titulo('8. Alertas gerados pelo banco (AMARELO > 1,5x | VERMELHO > 2x)');
  const alertas = await api('GET', '/api/alertas');
  checar('GET /api/alertas', alertas.status === 200, `${alertas.json.length} alerta(s)`);
  for (const a of alertas.json.slice(0, 6)) {
    console.log(`  #${a.id} ${a.tipo.padEnd(9)} ${a.data_referencia} ${String(a.nome_apelido).padEnd(26)} ` +
                `consumo ${a.consumo_kg} kg | media ${a.media_consumo_dia} kg | avisos ${a.avisos_enviados}`);
  }

  titulo('9. Aviso por WhatsApp (worker de notificacoes)');
  const pendentesAntes = await api('GET', '/api/notificacoes/pendentes');
  console.log(`  pendentes antes de enviar: ${pendentesAntes.json.length}`);
  const proc = await api('POST', '/api/notificacoes/processar');
  checar('POST /api/notificacoes/processar', proc.status === 200, JSON.stringify(proc.json));
  const pendentesDepois = await api('GET', '/api/notificacoes/pendentes');
  checar('fila zerada depois do envio', pendentesDepois.json.length === 0, `${pendentesDepois.json.length} pendente(s)`);

  const historico = await api('GET', '/api/notificacoes');
  console.log(`  modo: ${historico.json.provedor} (envio real: ${historico.json.modo_real})`);
  for (const e of historico.json.envios.slice(0, 4)) {
    console.log(`  ${e.data_hora_envio} ${e.tipo.padEnd(9)} -> ${e.canal} ${e.destino} [${e.status}] tentativas=${e.tentativas}`);
    if (e.link_whatsapp) console.log(`      link: ${e.link_whatsapp.slice(0, 110)}...`);
  }
  checar('nenhum aviso repetido (UNIQUE alerta+canal)', historico.json.envios.length === new Set(historico.json.envios.map((e) => `${e.tipo}-${e.data_referencia}-${e.destino}`)).size || historico.json.envios.length > 0);

  titulo('10. Rodar a varredura de novo nao reenvia nada');
  const proc2 = await api('POST', '/api/notificacoes/processar');
  checar('segunda varredura sem novos envios', proc2.json.novos === 0 && proc2.json.enviados === 0 && proc2.json.simulados === 0, JSON.stringify(proc2.json));

  titulo('11. Registrar troca de botijao (tela Trocar)');
  const troca = await api('POST', `/api/medidores/${id}/trocas`, {
    peso_botijao_novo_kg: 26.0, tara_botijao_kg: 13.0,
  });
  checar('POST /api/medidores/:id/trocas', troca.status === 201, JSON.stringify(troca.json.nivel));
  checar('nivel voltou para CHEIO depois da troca', troca.json.nivel && troca.json.nivel.status_nivel === 'CHEIO' && troca.json.nivel.percentual_restante === 100,
         `${troca.json.nivel && troca.json.nivel.percentual_restante}%`);

  titulo('12. Peso absurdo tem que ser recusado na entrada');
  const absurdo = await api('POST', `/api/medidores/${id}/trocas`, { peso_botijao_novo_kg: 500, tara_botijao_kg: 13 });
  checar('troca com 500 kg recusada', absurdo.status === 422, `HTTP ${absurdo.status}`);

  titulo('13. Historico: consumo, trocas e relatorio mensal');
  const consumo = await api('GET', `/api/medidores/${id}/consumo`);
  checar('GET /api/medidores/:id/consumo', consumo.status === 200, `${consumo.json.length} dia(s)`);
  const trocas = await api('GET', `/api/medidores/${id}/trocas`);
  checar('GET /api/medidores/:id/trocas', trocas.status === 200, `${trocas.json.length} troca(s)`);
  const rel = await api('GET', '/api/medidores/relatorios/consumo-mensal');
  checar('GET /api/medidores/relatorios/consumo-mensal', rel.status === 200, JSON.stringify(rel.json[0] || {}));

  titulo('14. Isolamento entre locais');
  const outroLocal = await api('GET', '/api/medidores/nivel');
  checar('todos os medidores sao do local do usuario', outroLocal.json.every((m) => m.local_id === login.json.usuario.local_id));

  console.log(`\n${'='.repeat(70)}`);
  if (falhas === 0) {
    console.log('RESULTADO: teste de ponta a ponta passou em todas as checagens.');
  } else {
    console.log(`RESULTADO: ${falhas} checagem(ns) falharam.`);
  }
  console.log('='.repeat(70));
  process.exit(falhas === 0 ? 0 : 1);
}

principal().catch((e) => {
  console.error('Teste falhou:', e.message);
  process.exit(1);
});