'use strict';

const path = require('path');
const express = require('express');

const config = require('./config');
const db = require('./db');
const notificacoes = require('./services/notificacoes');
const wa = require('./services/whatsapp');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// Log simples de requisicoes.
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - t0}ms)`);
    }
  });
  next();
});

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------
// Saude da API: fica publica e por isso e declarada ANTES do roteador de
// dispositivos (que exige login em tudo o que passa por ele).
app.get('/api/saude', async (req, res) => {
  try {
    const info = await db.testarConexao();
    res.json({
      ok: true,
      app: 'gasometro',
      versao: require('../package.json').version,
      banco: info,
      whatsapp: {
        provedor: wa.provedorAtivo(),
        modo_real: wa.provedorAtivo() !== 'simulado',
      },
      regras: config.regras,
      notificacoes: {
        ativo: config.notificacoes.ativo,
        intervalo_seg: config.notificacoes.intervaloSeg,
      },
      demo: config.demo,
      hora_servidor: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/medidores', require('./routes/medidores'));
app.use('/api/alertas', require('./routes/alertas'));
app.use('/api/canais', require('./routes/canais'));
app.use('/api/notificacoes', require('./routes/notificacoes'));
app.use('/api/demo', require('./routes/demo'));
app.use('/api', require('./routes/leituras')); // POST /api/leituras, /api/dispositivos, /api/calibracoes

// ---------------------------------------------------------------------
// App (PWA) - arquivos estaticos
// ---------------------------------------------------------------------
const pastaPublica = path.join(__dirname, '..', 'public');
app.use(express.static(pastaPublica, { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(pastaPublica, 'index.html')));

// ---------------------------------------------------------------------
// Tratamento de erro padrao
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[erro]', err.message);
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ erro: 'Registro duplicado: esse dado ja existe.' });
  }
  if (err.code && String(err.code).startsWith('ER_')) {
    return res.status(400).json({ erro: `Erro no banco (${err.code}): ${err.sqlMessage || err.message}` });
  }
  res.status(500).json({ erro: err.message || 'Erro interno.' });
});

// ---------------------------------------------------------------------
// Subida
// ---------------------------------------------------------------------
async function iniciar() {
  try {
    const info = await db.testarConexao();
    console.log(`[banco] conectado em ${info.banco} (fuso ${info.fuso}, event_scheduler=${info.scheduler})`);
  } catch (e) {
    console.error('[banco] nao consegui conectar:', e.message);
    console.error('       rode: npm run db:criar  (e confira o .env)');
  }

  notificacoes.iniciarWorker();

  app.listen(config.porta, '0.0.0.0', () => {
    console.log(`[gasometro] app e API no ar em http://0.0.0.0:${config.porta}`);
    console.log(`[gasometro] canal de aviso: ${wa.provedorAtivo()} ` +
                `(${wa.provedorAtivo() === 'simulado' ? 'modo simulado, sem envio real' : 'envio real'})`);
    console.log(`[gasometro] worker de notificacoes: ${config.notificacoes.ativo ? `a cada ${config.notificacoes.intervaloSeg}s` : 'desligado'}`);
  });
}

if (require.main === module) iniciar();

module.exports = { app, iniciar };
