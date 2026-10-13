'use strict';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function obrigatorio(nome, padrao) {
  const v = process.env[nome];
  return v === undefined || v === '' ? padrao : v;
}

const config = {
  porta: parseInt(obrigatorio('PORT', '3000'), 10),
  ambiente: obrigatorio('NODE_ENV', 'development'),

  // Modo demonstracao: habilita /api/demo/* e o simulador de leituras.
  demo: String(obrigatorio('DEMO_MODE', 'true')).toLowerCase() === 'true',

  jwt: {
    segredo: obrigatorio('JWT_SECRET', crypto.randomBytes(32).toString('hex')),
    validade: obrigatorio('JWT_EXPIRA_EM', '12h'),
  },

  banco: {
    host: obrigatorio('DB_HOST', '127.0.0.1'),
    porta: parseInt(obrigatorio('DB_PORT', '3306'), 10),
    usuario: obrigatorio('DB_USER', 'gasometro'),
    senha: obrigatorio('DB_PASSWORD', 'gasometro'),
    database: obrigatorio('DB_NAME', 'gas'),
    connectionLimit: parseInt(obrigatorio('DB_POOL', '10'), 10),
  },

  // ---------------------------------------------------------------------
  // Regras de negocio que o guia deixou como "suposicoes a confirmar".
  // Estao todas aqui, num lugar so, para virar decisao explicita.
  // ---------------------------------------------------------------------
  regras: {
    // Limites de status do botijao usados pela vw_nivel_atual (banco).
    // Aqui ficam apenas para exibir na tela; a fonte da verdade e a view.
    limiteCheioPct: parseInt(obrigatorio('LIMITE_CHEIO_PCT', '50'), 10),
    limiteBaixoPct: parseInt(obrigatorio('LIMITE_BAIXO_PCT', '15'), 10),

    // Sem leitura por X horas => medidor OFFLINE (evento horario do banco).
    horasOffline: parseInt(obrigatorio('HORAS_OFFLINE', '2'), 10),

    // Validacao do que o ESP32 pode enviar (o banco sozinho nao faz isso).
    margemLeituraKg: parseFloat(obrigatorio('MARGEM_LEITURA_KG', '0.5')),
  },

  // ---------------------------------------------------------------------
  // WhatsApp - canal de aviso do app.
  //   provedor = simulado  -> nao envia de verdade, gera link wa.me e registra
  //   provedor = meta      -> WhatsApp Cloud API (Meta)
  //   provedor = twilio    -> Twilio WhatsApp API
  // ---------------------------------------------------------------------
  whatsapp: {
    provedor: String(obrigatorio('WHATSAPP_PROVIDER', 'simulado')).toLowerCase(),
    // Meta WhatsApp Cloud API
    meta: {
      versao: obrigatorio('META_API_VERSION', 'v21.0'),
      phoneNumberId: obrigatorio('META_PHONE_NUMBER_ID', ''),
      token: obrigatorio('META_TOKEN', ''),
      templateNome: obrigatorio('META_TEMPLATE', ''), // vazio = mensagem de texto livre
      idioma: obrigatorio('META_TEMPLATE_IDIOMA', 'pt_BR'),
    },
    // Twilio
    twilio: {
      accountSid: obrigatorio('TWILIO_ACCOUNT_SID', ''),
      authToken: obrigatorio('TWILIO_AUTH_TOKEN', ''),
      from: obrigatorio('TWILIO_WHATSAPP_FROM', ''), // ex.: whatsapp:+14155238886
    },
    // Assinatura curta das mensagens
    remetente: obrigatorio('WHATSAPP_REMETENTE', 'Gasometro'),
  },

  // Worker que varre alertas pendentes e dispara o aviso.
  notificacoes: {
    ativo: String(obrigatorio('NOTIF_WORKER', 'true')).toLowerCase() === 'true',
    intervaloSeg: parseInt(obrigatorio('NOTIF_INTERVALO_SEG', '60'), 10),
    maxTentativas: parseInt(obrigatorio('NOTIF_MAX_TENTATIVAS', '5'), 10),
  },
};

module.exports = config;