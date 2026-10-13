'use strict';

const config = require('../config');

// ---------------------------------------------------------------------
// Formatacao das mensagens
// ---------------------------------------------------------------------

const fmtPeso = (v) => (v === null || v === undefined ? '--' : `${Number(v).toFixed(2)} kg`);
const fmtData = (d) => {
  if (!d) return '--';
  const data = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T12:00:00`);
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const EMOJI_TIPO = { VERMELHO: '🔴', AMARELO: '🟡' };

// Mensagem de alerta de consumo anormal (AMARELO = 1,5x a media, VERMELHO = 2x).
function textoAlerta(alerta) {
  const tipo = alerta.tipo;
  const linhas = [
    `${EMOJI_TIPO[tipo] || ''} *${config.whatsapp.remetente} - ALERTA ${tipo}*`.trim(),
    '',
    `Medidor: ${alerta.nome_apelido || `#${alerta.medidor_id}`}`,
    `Consumo em ${fmtData(alerta.data_referencia)}: *${fmtPeso(alerta.consumo_kg)}*`,
  ];
  if (alerta.media_consumo_dia) {
    const vezes = (alerta.consumo_kg / alerta.media_consumo_dia).toFixed(1);
    linhas.push(`Media de 7 dias: ${fmtPeso(alerta.media_consumo_dia)} (${vezes}x)`);
  }
  if (alerta.gas_restante_kg !== null && alerta.gas_restante_kg !== undefined) {
    linhas.push(`Nivel atual: ${alerta.percentual_restante}% (${fmtPeso(alerta.gas_restante_kg)})`);
  }
  if (alerta.data_estimada_troca) {
    linhas.push(`Troca prevista: ${fmtData(alerta.data_estimada_troca)}`);
  }
  linhas.push('', 'Confira o consumo na aba Historico do app.');
  return linhas.join('\n');
}

// Mensagem de teste, usada na tela Canais/WhatsApp.
function textoTeste(nome_local) {
  return [
    `✅ *${config.whatsapp.remetente}*`,
    '',
    `Este e o canal de avisos do local *${nome_local}*.`,
    'Voce vai receber aqui os alertas de consumo anormal e o aviso de troca de botijao.',
  ].join('\n');
}

// ---------------------------------------------------------------------
// Link de fallback (wa.me) - funciona sem nenhuma credencial
// ---------------------------------------------------------------------
function apenasDigitos(telefone) {
  return String(telefone || '').replace(/[^\d]/g, '');
}

function linkWhatsapp(destino, texto) {
  return `https://wa.me/${apenasDigitos(destino)}?text=${encodeURIComponent(texto)}`;
}

// ---------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------
async function enviarMeta(destino, texto) {
  const { versao, phoneNumberId, token, templateNome, idioma } = config.whatsapp.meta;
  if (!phoneNumberId || !token) {
    throw new Error('META_PHONE_NUMBER_ID e META_TOKEN nao configurados');
  }
  const url = `https://graph.facebook.com/${versao}/${phoneNumberId}/messages`;
  const corpo = templateNome
    ? {
        messaging_product: 'whatsapp',
        to: apenasDigitos(destino),
        type: 'template',
        template: {
          name: templateNome,
          language: { code: idioma },
          components: [{ type: 'body', parameters: [{ type: 'text', text: texto }] }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: apenasDigitos(destino),
        type: 'text',
        text: { preview_url: false, body: texto },
      };

  const resposta = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(`Meta ${resposta.status}: ${JSON.stringify(json.error || json)}`);
  }
  return { id_externo: json.messages && json.messages[0] && json.messages[0].id };
}

async function enviarTwilio(destino, texto) {
  const { accountSid, authToken, from } = config.whatsapp.twilio;
  if (!accountSid || !authToken || !from) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_WHATSAPP_FROM nao configurados');
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const corpo = new URLSearchParams({
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    To: `whatsapp:+${apenasDigitos(destino)}`,
    Body: texto,
  });
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: corpo.toString(),
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(`Twilio ${resposta.status}: ${json.message || ''}`);
  }
  return { id_externo: json.sid };
}

// Modo simulado: nada sai para a internet. O aviso fica registrado no banco
// com um link wa.me pronto para abrir/conferir.
function enviarSimulado(destino, texto) {
  if (!apenasDigitos(destino)) {
    throw new Error(`Destino invalido: "${destino}". Use DDI+DDD+numero, ex.: +5511999999999`);
  }
  return { id_externo: `simulado-${Date.now()}` };
}

const PROVEDORES = { meta: enviarMeta, twilio: enviarTwilio, simulado: enviarSimulado };

/**
 * Envia uma mensagem pelo canal configurado.
 * Retorna { status, provedor, modo, id_externo, erro, link_whatsapp }.
 * Nunca lanca excecao: o worker decide o que fazer com o retorno.
 */
async function enviar(destino, texto) {
  const provedor = PROVEDORES[config.whatsapp.provedor] ? config.whatsapp.provedor : 'simulado';
  const link = linkWhatsapp(destino, texto);
  try {
    const r = await PROVEDORES[provedor](destino, texto);
    return {
      status: provedor === 'simulado' ? 'SIMULADO' : 'ENVIADO',
      provedor,
      modo: provedor === 'simulado' ? 'SIMULADO' : 'API',
      id_externo: r.id_externo || null,
      erro: null,
      link_whatsapp: link,
    };
  } catch (e) {
    return {
      status: 'ERRO',
      provedor,
      modo: 'API',
      id_externo: null,
      erro: String(e.message || e).slice(0, 480),
      link_whatsapp: link,
    };
  }
}

module.exports = {
  enviar,
  textoAlerta,
  textoTeste,
  linkWhatsapp,
  apenasDigitos,
  provedorAtivo: () => config.whatsapp.provedor,
};