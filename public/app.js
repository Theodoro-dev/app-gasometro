/* =====================================================================
   Gasometro - app (PWA). Fala apenas com a API; nunca com o MySQL.
   ===================================================================== */
'use strict';

const CHAVE_TOKEN = 'gasometro.token';

const estado = {
  token: localStorage.getItem(CHAVE_TOKEN) || null,
  usuario: null,
  medidores: [],
  nivel: [],
  alertas: [],
  rota: 'inicio',
  medidorSel: null,
  abaHistorico: 'consumo',
  saude: null,
};

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */
const nf = (v, casas = 2) => (v === null || v === undefined ? '--' : Number(v).toFixed(casas));
const peso = (v) => (v === null || v === undefined ? '--' : `${nf(v)} kg`);
const pct = (v) => (v === null || v === undefined ? '--' : `${Math.round(Number(v))}%`);

function dataBR(iso) {
  if (!iso) return '--';
  const s = String(iso).slice(0, 10);
  const [a, m, d] = s.split('-');
  return a && m && d ? `${d}/${m}/${a}` : '--';
}
function dataHoraBR(iso) {
  if (!iso) return '--';
  const s = String(iso).replace('T', ' ');
  return `${dataBR(s)} ${s.slice(11, 16)}`;
}
function desde(iso) {
  if (!iso) return 'sem leitura';
  const ms = Date.now() - new Date(String(iso).replace(' ', 'T')).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min atras`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h atras`;
  return `${Math.round(h / 24)} dia(s) atras`;
}

function toast(mensagem, tipo = '') {
  const t = $('#toast');
  t.className = `toast ${tipo}`;
  t.textContent = mensagem;
  t.classList.remove('oculto');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('oculto'), 5000);
}

function escapar(txt) {
  return String(txt ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Cliente da API                                                      */
/* ------------------------------------------------------------------ */
async function api(metodo, caminho, corpo) {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 401 && estado.rota !== 'login') sair();
    throw new Error(json.erro || `Falha na requisicao (${resposta.status})`);
  }
  return json;
}

/* ------------------------------------------------------------------ */
/* Componentes                                                         */
/* ------------------------------------------------------------------ */
function classeStatus(status) {
  return ['CHEIO', 'BAIXO', 'CRITICO'].includes(status) ? status : 'SEM';
}

function anel(percentual, status) {
  const p = Math.max(0, Math.min(100, Number(percentual) || 0));
  const r = 36;
  const c = 2 * Math.PI * r;
  const cor = status === 'CRITICO' ? '#ff6b6b' : status === 'BAIXO' ? '#f5c451' : '#2ee6a8';
  const traco = (c * p) / 100;
  return `
    <div class="anel">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r="${r}" fill="none" stroke="#0d1728" stroke-width="9"></circle>
        <circle cx="44" cy="44" r="${r}" fill="none" stroke="${cor}" stroke-width="9"
                stroke-linecap="round" stroke-dasharray="${traco} ${c - traco}"></circle>
      </svg>
      <div class="valor"><b>${pct(percentual)}</b><span>nivel</span></div>
    </div>`;
}

function etiqueta(texto, classe) {
  return `<span class="etiqueta ${classe || ''}">${escapar(texto)}</span>`;
}

function barra(percentual, status) {
  const p = Math.max(0, Math.min(100, Number(percentual) || 0));
  const c = status === 'CRITICO' ? 'critico' : status === 'BAIXO' ? 'baixo' : '';
  return `<div class="barra"><i class="${c}" style="width:${p}%"></i></div>`;
}

function vazio(mensagem) {
  return `<div class="estado-vazio">
    <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/></svg>
    <p>${escapar(mensagem)}</p></div>`;
}

/* ------------------------------------------------------------------ */
/* Login / sessão                                                      */
/* ------------------------------------------------------------------ */
async function entrar(email, senha) {
  const r = await api('POST', '/api/auth/login', { email, senha });
  estado.token = r.token;
  estado.usuario = r.usuario;
  localStorage.setItem(CHAVE_TOKEN, r.token);
  await abrirApp();
}

function sair() {
  localStorage.removeItem(CHAVE_TOKEN);
  estado.token = null;
  estado.usuario = null;
  $('#app').classList.add('oculto');
  $('#tela-login').classList.remove('oculto');
}

async function abrirApp() {
  if (!estado.usuario) estado.usuario = await api('GET', '/api/auth/eu');
  $('#tela-login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  $('#nome-local').textContent = estado.usuario.nome_local;
  $('#email-usuario').textContent = estado.usuario.email;

  try {
    estado.saude = await api('GET', '/api/saude');
    $('#status-conexao').className = 'ponto-status';
    const selo = $('#selo-whatsapp');
    const real = estado.saude.whatsapp.modo_real;
    selo.textContent = real
      ? `WhatsApp: ${estado.saude.whatsapp.provedor}`
      : 'WhatsApp: modo simulado';
    selo.className = `selo ${real ? 'verde' : 'amarelo'}`;
  } catch (e) {
    $('#status-conexao').className = 'ponto-status ruim';
  }

  await navegar('inicio');
}

/* ------------------------------------------------------------------ */
/* Navegação                                                           */
/* ------------------------------------------------------------------ */
async function navegar(rota) {
  estado.rota = rota;
  document.querySelectorAll('.aba').forEach((b) => {
    b.classList.toggle('ativa', b.dataset.rota === rota);
  });
  const conteudo = $('#conteudo');
  conteudo.innerHTML = '<div class="estado-vazio">Carregando...</div>';
  try {
    await TELAS[rota]();
  } catch (e) {
    conteudo.innerHTML = `<div class="aviso erro">${escapar(e.message)}</div>`;
  }
}

async function carregarBase() {
  const [medidores, nivel, alertas] = await Promise.all([
    api('GET', '/api/medidores'),
    api('GET', '/api/medidores/nivel'),
    api('GET', '/api/alertas?limite=10'),
  ]);
  estado.medidores = medidores;
  estado.nivel = nivel;
  estado.alertas = alertas;
  if (!estado.medidorSel && nivel.length) estado.medidorSel = nivel[0].medidor_id;
}

/* ------------------------------------------------------------------ */
/* Tela 01 - Início                                                    */
/* ------------------------------------------------------------------ */
async function telaInicio() {
  await carregarBase();
  const previsoes = await Promise.all(
    estado.nivel.map((m) => api('GET', `/api/medidores/${m.medidor_id}/previsao`).catch(() => ({})))
  );
  const resumo = await api('GET', '/api/alertas/resumo').catch(() => ({}));

  const faixa = `
    <div class="faixa">
      <div>
        <strong>${estado.saude && estado.saude.whatsapp.modo_real ? 'Avisos por WhatsApp ativos' : 'Avisos por WhatsApp em modo simulado'}</strong>
        <div class="texto-miudo">Provedor ${escapar(estado.saude ? estado.saude.whatsapp.provedor : '--')} ·
          ${escapar(String(resumo.avisos_enviados || 0))} aviso(s) enviado(s) ·
          ${escapar(String(resumo.vermelhos_30d || 0))} alerta(s) vermelho(s) em 30 dias</div>
      </div>
      <div class="rodape-acoes">
        <button class="botao whats pequeno" id="btn-enviar-avisos" type="button">Enviar avisos pendentes</button>
        <button class="botao pequeno" id="btn-ir-whatsapp" type="button">Ver WhatsApp</button>
      </div>
    </div>`;

  const cartoes = estado.nivel.length
    ? estado.nivel.map((m, i) => {
        const p = previsoes[i] || {};
        return `
        <div class="bloco">
          <div class="bloco-topo">
            <div>
              <h3>${escapar(m.nome_apelido || m.identificador_esp32)}</h3>
              <div class="texto-miudo">${escapar(m.identificador_esp32)} · leitura ${desde(m.data_hora_leitura)}</div>
            </div>
            <div>${etiqueta(m.status_nivel, classeStatus(m.status_nivel))} ${etiqueta(m.status_medidor, m.status_medidor === 'ATIVO' ? 'ATIVO' : m.status_medidor)}</div>
          </div>
          <div class="medidor">
            ${anel(m.percentual_restante, m.status_nivel)}
            <div style="flex:1">
              ${barra(m.percentual_restante, m.status_nivel)}
              <dl class="dados">
                <dt>Gas restante</dt><dd>${peso(m.gas_restante_kg)}</dd>
                <dt>Peso total lido</dt><dd>${peso(m.peso_total_kg)}</dd>
                <dt>Media de 7 dias</dt><dd>${p.media_consumo_dia ? `${peso(p.media_consumo_dia)}/dia` : 'sem historico'}</dd>
                <dt>Troca prevista</dt>
                <dd>${p.data_estimada_troca ? `${dataBR(p.data_estimada_troca)} (${p.dias_estimados_restantes} dias)` : 'sem previsao'}</dd>
              </dl>
            </div>
          </div>
        </div>`;
      }).join('')
    : `<div class="bloco">${vazio('Cadastre um medidor para ver o nivel do botijao.')}</div>`;

  const alertas = estado.alertas.length
    ? `<ul class="lista">${estado.alertas.map((a) => `
        <li>
          <div class="principal">
            <b>${etiqueta(a.tipo, a.tipo)} ${escapar(a.nome_apelido || '')}</b>
            <span>${dataBR(a.data_referencia)} · consumo ${peso(a.consumo_kg)} · media ${peso(a.media_consumo_dia)}</span>
          </div>
          <div class="texto-miudo">${a.avisos_enviados > 0 ? `${a.avisos_enviados} aviso(s) enviado(s)` : 'aviso pendente'}</div>
        </li>`).join('')}</ul>`
    : vazio('Nenhum consumo fora do padrao nos ultimos dias.');

  $('#conteudo').innerHTML = `
    ${faixa}
    <div class="grade duas">${cartoes}</div>
    <div class="bloco" style="margin-top:14px">
      <div class="bloco-topo"><h3>Alertas recentes</h3></div>
      ${alertas}
    </div>`;

  $('#btn-enviar-avisos').onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      const r = await api('POST', '/api/notificacoes/processar');
      toast(`Avisos: ${r.enviados} enviado(s), ${r.simulados} simulado(s), ${r.erros} erro(s).`, r.erros ? 'erro' : 'ok');
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      b.disabled = false;
    }
  };
  $('#btn-ir-whatsapp').onclick = () => navegar('whatsapp');
}

/* ------------------------------------------------------------------ */
/* Tela 02 - Botijões                                                  */
/* ------------------------------------------------------------------ */
async function telaBotijoes() {
  await carregarBase();
  if (!estado.medidores.length) {
    $('#conteudo').innerHTML = `<div class="bloco">${vazio('Nenhum medidor cadastrado neste local.')}</div>`;
    return;
  }
  const cartoes = estado.medidores.map((m) => {
    const temLeitura = m.percentual_restante !== null && m.percentual_restante !== undefined;
    return `
      <div class="bloco">
        <div class="bloco-topo">
          <div>
            <h3>${escapar(m.nome_apelido || m.identificador_esp32)}</h3>
            <div class="texto-miudo">${escapar(m.identificador_esp32)}</div>
          </div>
          <div>
            ${etiqueta(m.status_nivel || 'SEM LEITURA', temLeitura ? classeStatus(m.status_nivel) : 'SEM')}
            ${etiqueta(m.status, m.status === 'ATIVO' ? 'ATIVO' : m.status)}
          </div>
        </div>
        ${temLeitura ? barra(m.percentual_restante, m.status_nivel) : '<div class="barra"><i style="width:0%"></i></div>'}
        <dl class="dados">
          <dt>Nivel</dt><dd>${temLeitura ? pct(m.percentual_restante) : 'sem leitura ainda'}</dd>
          <dt>Gas restante</dt><dd>${temLeitura ? peso(m.gas_restante_kg) : '--'}</dd>
          <dt>Capacidade / tara</dt><dd>${peso(m.capacidade_botijao_kg)} / ${peso(m.peso_vazio_botijao_kg)}</dd>
          <dt>Ultima leitura</dt><dd>${temLeitura ? `${dataHoraBR(m.data_hora_leitura)}<br><span class="texto-miudo">${desde(m.data_hora_leitura)}</span>` : '--'}</dd>
          <dt>Envio do ESP32</dt><dd>${escapar(String(m.intervalo_envio_seg))} s</dd>
        </dl>
        <div class="rodape-acoes">
          <button class="botao pequeno" data-trocar="${m.id}" type="button">Registrar troca</button>
          <button class="botao pequeno" data-historico="${m.id}" type="button">Ver historico</button>
        </div>
      </div>`;
  }).join('');

  $('#conteudo').innerHTML = `<div class="grade duas">${cartoes}</div>`;

  document.querySelectorAll('[data-trocar]').forEach((b) => {
    b.onclick = () => { estado.medidorSel = Number(b.dataset.trocar); navegar('trocar'); };
  });
  document.querySelectorAll('[data-historico]').forEach((b) => {
    b.onclick = () => { estado.medidorSel = Number(b.dataset.historico); navegar('historico'); };
  });
}

/* ------------------------------------------------------------------ */
/* Tela 03 - Trocar                                                    */
/* ------------------------------------------------------------------ */
async function telaTrocar() {
  await carregarBase();
  if (!estado.nivel.length) {
    $('#conteudo').innerHTML = `<div class="bloco">${vazio('Cadastre um medidor antes de registrar uma troca.')}</div>`;
    return;
  }
  const opcoes = estado.nivel.map((m) =>
    `<option value="${m.medidor_id}" ${m.medidor_id === estado.medidorSel ? 'selected' : ''}>
       ${escapar(m.nome_apelido || m.identificador_esp32)} (${pct(m.percentual_restante)})
     </option>`).join('');

  const trocas = estado.medidorSel
    ? await api('GET', `/api/medidores/${estado.medidorSel}/trocas`).catch(() => [])
    : [];

  $('#conteudo').innerHTML = `
    <div class="grade duas">
      <div class="bloco">
        <div class="bloco-topo"><h3>Registrar troca de botijao</h3></div>
        <div class="linha-form">
          <div><label for="medidor-troca">Medidor</label><select id="medidor-troca">${opcoes}</select></div>
          <div><label for="peso-novo">Peso total do botijao novo (kg)</label>
            <input id="peso-novo" type="number" step="0.01" min="0" placeholder="26.00"></div>
          <div class="linha-form duas">
            <div><label for="tara-nova">Tara do botijao (kg, opcional)</label>
              <input id="tara-nova" type="number" step="0.01" min="0" placeholder="13.00"></div>
            <div><label for="quando">Data e hora</label><input id="quando" type="datetime-local"></div>
          </div>
        </div>
        <div class="rodape-acoes">
          <button class="botao primario" id="btn-confirmar-troca" type="button" style="width:auto">Confirmar troca</button>
          <button class="botao pequeno" id="btn-botijao-cheio" type="button">Botijao cheio</button>
        </div>
        <p class="texto-miudo" style="margin-top:10px">
          Depois da troca o nivel e a previsao se recalculam sozinhos: a view usa a tara da ultima troca
          e o dia da troca e dividido em trechos no calculo do consumo.
        </p>
      </div>
      <div class="bloco">
        <div class="bloco-topo"><h3>Trocas registradas</h3></div>
        ${trocas.length ? `<table class="tabela">
          <thead><tr><th>Data</th><th class="num">Peso novo</th><th class="num">Tara</th></tr></thead>
          <tbody>${trocas.map((t) => `<tr>
            <td>${dataHoraBR(t.data_hora)}</td>
            <td class="num">${peso(t.peso_botijao_novo_kg)}</td>
            <td class="num">${t.tara_botijao_kg === null ? '--' : peso(t.tara_botijao_kg)}</td>
          </tr>`).join('')}</tbody></table>`
        : vazio('Nenhuma troca registrada para este medidor.')}
      </div>
    </div>`;

  const preencherCheio = () => {
    const m = estado.nivel.find((x) => x.medidor_id === Number($('#medidor-troca').value));
    if (!m) return;
    $('#peso-novo').value = (Number(m.capacidade_botijao_kg) + Number(m.peso_vazio_botijao_kg)).toFixed(2);
    $('#tara-nova').value = Number(m.peso_vazio_botijao_kg).toFixed(2);
  };
  $('#btn-botijao-cheio').onclick = preencherCheio;
  $('#medidor-troca').onchange = () => { estado.medidorSel = Number($('#medidor-troca').value); navegar('trocar'); };
  preencherCheio();

  const agoraLocal = () => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };
  $('#quando').value = agoraLocal();

  $('#btn-confirmar-troca').onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      const corpo = {
        peso_botijao_novo_kg: Number($('#peso-novo').value),
        tara_botijao_kg: $('#tara-nova').value === '' ? null : Number($('#tara-nova').value),
      };
      if ($('#quando').value) corpo.data_hora = $('#quando').value;
      const r = await api('POST', `/api/medidores/${$('#medidor-troca').value}/trocas`, corpo);
      toast(`Troca registrada. Nivel agora: ${pct(r.nivel.percentual_restante)} (${r.nivel.status_nivel}).`, 'ok');
      await navegar('trocar');
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      b.disabled = false;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Tela 04 - Histórico                                                 */
/* ------------------------------------------------------------------ */
async function telaHistorico() {
  await carregarBase();
  if (!estado.medidores.length) {
    $('#conteudo').innerHTML = `<div class="bloco">${vazio('Sem medidores para mostrar historico.')}</div>`;
    return;
  }
  const opcoes = estado.medidores.map((m) =>
    `<option value="${m.id}" ${m.id === estado.medidorSel ? 'selected' : ''}>${escapar(m.nome_apelido || m.identificador_esp32)}</option>`).join('');

  const id = estado.medidorSel || estado.medidores[0].id;
  const [consumo, alertas, trocas, relatorio] = await Promise.all([
    api('GET', `/api/medidores/${id}/consumo`),
    api('GET', `/api/alertas?limite=40`),
    api('GET', `/api/medidores/${id}/trocas`),
    api('GET', '/api/medidores/relatorios/consumo-mensal').catch(() => []),
  ]);

  const total = consumo.reduce((s, d) => s + (Number(d.consumo_kg) || 0), 0);
  const comConsumo = consumo.filter((d) => d.consumo_kg !== null);
  const media = comConsumo.length ? total / comConsumo.length : 0;

  const aba = estado.abaHistorico;
  let painel = '';

  if (aba === 'consumo') {
    painel = `
      <canvas id="grafico" height="190"></canvas>
      <p class="texto-miudo" style="margin-top:8px">
        ${consumo.length} dia(s) no periodo · total ${peso(total)} · media ${peso(media)}/dia ·
        dias sem leitura suficiente aparecem em branco (consumo NULL)
      </p>
      <div style="max-height:290px;overflow:auto;margin-top:10px">
        <table class="tabela">
          <thead><tr><th>Dia</th><th class="num">Inicio</th><th class="num">Fim</th><th class="num">Consumo</th><th>Dia util</th></tr></thead>
          <tbody>${consumo.slice().reverse().map((d) => `<tr>
            <td>${dataBR(d.data)}</td>
            <td class="num">${peso(d.peso_inicio_dia_kg)}</td>
            <td class="num">${peso(d.peso_fim_dia_kg)}</td>
            <td class="num">${d.consumo_kg === null ? '<span class="texto-miudo">sem dados</span>' : peso(d.consumo_kg)}</td>
            <td>${d.dia_util ? 'sim' : 'nao'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } else if (aba === 'alertas') {
    painel = alertas.length ? `<table class="tabela">
        <thead><tr><th>Data</th><th>Tipo</th><th>Medidor</th><th class="num">Consumo</th><th class="num">Media</th><th>Aviso</th></tr></thead>
        <tbody>${alertas.map((a) => `<tr>
          <td>${dataBR(a.data_referencia)}</td>
          <td>${etiqueta(a.tipo, a.tipo)}</td>
          <td>${escapar(a.nome_apelido || '')}</td>
          <td class="num">${peso(a.consumo_kg)}</td>
          <td class="num">${peso(a.media_consumo_dia)}</td>
          <td>${a.avisos_enviados > 0 ? `${a.avisos_enviados} enviado(s)` : 'pendente'}</td>
        </tr>`).join('')}</tbody></table>`
      : vazio('Nenhum alerta registrado.');
  } else if (aba === 'trocas') {
    painel = trocas.length ? `<table class="tabela">
        <thead><tr><th>Data e hora</th><th class="num">Peso novo</th><th class="num">Tara</th></tr></thead>
        <tbody>${trocas.map((t) => `<tr>
          <td>${dataHoraBR(t.data_hora)}</td><td class="num">${peso(t.peso_botijao_novo_kg)}</td>
          <td class="num">${t.tara_botijao_kg === null ? '--' : peso(t.tara_botijao_kg)}</td>
        </tr>`).join('')}</tbody></table>`
      : vazio('Nenhuma troca registrada.');
  } else {
    painel = relatorio.length ? `<table class="tabela">
        <thead><tr><th>Mes</th><th>Tipo de local</th><th class="num">Consumo total</th><th class="num">Dias medidos</th></tr></thead>
        <tbody>${relatorio.map((r) => `<tr>
          <td>${r.mes}</td><td>${r.tipo_local}</td><td class="num">${peso(r.consumo_total_kg)}</td>
          <td class="num">${r.dias_medidos}</td>
        </tr>`).join('')}</tbody></table>`
      : vazio('Sem consumo consolidado por mes ainda.');
  }

  $('#conteudo').innerHTML = `
    <div class="bloco">
      <div class="bloco-topo">
        <div><h3>Historico</h3><div class="texto-miudo">Consumo, alertas e trocas deste medidor</div></div>
        <div style="min-width:220px"><label for="filtro-medidor">Medidor</label>
          <select id="filtro-medidor">${opcoes}</select></div>
      </div>
      <div class="abas-internas">
        <button data-aba="consumo" class="${aba === 'consumo' ? 'ativa' : ''}">Consumo</button>
        <button data-aba="alertas" class="${aba === 'alertas' ? 'ativa' : ''}">Alertas</button>
        <button data-aba="trocas" class="${aba === 'trocas' ? 'ativa' : ''}">Trocas</button>
        <button data-aba="relatorio" class="${aba === 'relatorio' ? 'ativa' : ''}">Por mes</button>
      </div>
      ${painel}
    </div>`;

  $('#filtro-medidor').onchange = (ev) => { estado.medidorSel = Number(ev.target.value); navegar('historico'); };
  document.querySelectorAll('[data-aba]').forEach((b) => {
    b.onclick = () => { estado.abaHistorico = b.dataset.aba; navegar('historico'); };
  });

  if (aba === 'consumo' && consumo.length) desenharGrafico(consumo, media);
}

function desenharGrafico(dados, media) {
  const canvas = $('#grafico');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const largura = canvas.clientWidth || 640;
  const altura = 190;
  canvas.width = largura * dpr;
  canvas.height = altura * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, largura, altura);

  const padEsq = 40; const padDir = 10; const padTopo = 14; const padBase = 26;
  const areaL = largura - padEsq - padDir;
  const areaA = altura - padTopo - padBase;
  const maxV = Math.max(0.5, ...dados.map((d) => Number(d.consumo_kg) || 0), media);
  const passo = areaL / Math.max(1, dados.length);
  const larg = Math.max(4, Math.min(26, passo * 0.62));

  // linhas de referencia
  ctx.strokeStyle = '#243350';
  ctx.fillStyle = '#96a4bf';
  ctx.font = '10px system-ui';
  for (let i = 0; i <= 4; i += 1) {
    const y = padTopo + (areaA * i) / 4;
    ctx.beginPath(); ctx.moveTo(padEsq, y); ctx.lineTo(largura - padDir, y); ctx.stroke();
    ctx.fillText(`${((maxV * (4 - i)) / 4).toFixed(1)}`, 4, y + 3);
  }
  // media
  if (media > 0) {
    const y = padTopo + areaA - (media / maxV) * areaA;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#5aa9ff';
    ctx.beginPath(); ctx.moveTo(padEsq, y); ctx.lineTo(largura - padDir, y); ctx.stroke();
    ctx.restore();
  }
  // barras
  dados.forEach((d, i) => {
    const v = Number(d.consumo_kg);
    if (v === null || Number.isNaN(v)) return;
    const h = (v / maxV) * areaA;
    const x = padEsq + i * passo + (passo - larg) / 2;
    const y = padTopo + areaA - h;
    const cor = v > media * 2 ? '#ff6b6b' : v > media * 1.5 ? '#f5c451' : '#2ee6a8';
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.roundRect(x, y, larg, Math.max(2, h), 3);
    ctx.fill();
  });
  // rotulos
  ctx.fillStyle = '#96a4bf';
  const cada = Math.ceil(dados.length / 8);
  dados.forEach((d, i) => {
    if (i % cada !== 0 && i !== dados.length - 1) return;
    const x = padEsq + i * passo + passo / 2;
    ctx.save();
    ctx.translate(x, altura - 8);
    ctx.fillText(String(d.data).slice(5).replace('-', '/'), -14, 0);
    ctx.restore();
  });
}

/* ------------------------------------------------------------------ */
/* Tela 05 - WhatsApp                                                  */
/* ------------------------------------------------------------------ */
async function telaWhatsapp() {
  const [canais, envios, pendentes] = await Promise.all([
    api('GET', '/api/canais'),
    api('GET', '/api/notificacoes?limite=25'),
    api('GET', '/api/notificacoes/pendentes'),
  ]);

  const lista = canais.canais.length ? `<ul class="lista">${canais.canais.map((c) => `
      <li>
        <div class="principal">
          <b>${escapar(c.tipo)} · ${escapar(c.destino)}</b>
          <span>${c.ativo ? 'ativo' : 'desativado'}</span>
        </div>
        <div class="rodape-acoes" style="margin:0">
          <button class="botao pequeno whats" data-testar="${c.id}" type="button">Enviar teste</button>
          <button class="botao pequeno" data-alternar="${c.id}" data-ativo="${c.ativo ? 1 : 0}" type="button">${c.ativo ? 'Desativar' : 'Ativar'}</button>
        </div>
      </li>`).join('')}</ul>`
    : vazio('Nenhum canal cadastrado. Cadastre seu numero de WhatsApp abaixo.');

  const historico = envios.envios.length ? `
    <div style="max-height:340px;overflow:auto">
      <table class="tabela">
        <thead><tr><th>Enviado</th><th>Alerta</th><th>Medidor</th><th>Destino</th><th>Status</th><th></th></tr></thead>
        <tbody>${envios.envios.map((e) => `<tr>
          <td>${dataHoraBR(e.data_hora_envio)}</td>
          <td>${etiqueta(e.tipo, e.tipo)} ${dataBR(e.data_referencia)}</td>
          <td>${escapar(e.nome_apelido || '')}</td>
          <td class="mono">${escapar(e.destino)}</td>
          <td>${escapar(e.status)}${e.erro ? `<br><span class="texto-miudo">${escapar(e.erro.slice(0, 70))}</span>` : ''}</td>
          <td>${e.link_whatsapp ? `<a class="botao pequeno" href="${escapar(e.link_whatsapp)}" target="_blank" rel="noopener">Abrir</a>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`
    : vazio('Nenhum aviso enviado ainda.');

  const avisoModo = envios.modo_real
    ? `<div class="aviso ok">Envio real ativo pelo provedor <b>${escapar(envios.provedor)}</b>. Os alertas saem sozinhos pelo worker.</div>`
    : `<div class="aviso info">Modo <b>simulado</b>: o aviso e registrado no banco e voce recebe um link
         <span class="mono">wa.me</span> pronto para conferir. Para envio automatico de verdade, preencha
         <span class="mono">WHATSAPP_PROVIDER</span> e as credenciais da Meta ou do Twilio no arquivo <span class="mono">.env</span>.</div>`;

  $('#conteudo').innerHTML = `
    <div class="grade duas">
      <div class="bloco">
        <div class="bloco-topo"><h3>Canais de aviso</h3><span class="selo ${envios.modo_real ? 'verde' : 'amarelo'}">${escapar(envios.provedor)}</span></div>
        ${avisoModo}
        <div style="margin-top:12px">${lista}</div>
        <div class="linha-form duas" style="margin-top:14px">
          <div><label for="novo-canal">Tipo</label>
            <select id="novo-canal">
              <option value="WHATSAPP">WhatsApp</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">E-mail</option>
              <option value="PUSH">Push</option>
            </select></div>
          <div><label for="novo-destino">Destino</label>
            <input id="novo-destino" placeholder="+5511999999999"></div>
        </div>
        <div class="rodape-acoes">
          <button class="botao primario pequeno" id="btn-add-canal" type="button" style="width:auto">Adicionar canal</button>
        </div>
      </div>
      <div class="bloco">
        <div class="bloco-topo">
          <div><h3>Fila de avisos</h3><div class="texto-miudo">${pendentes.length} alerta(s) ainda sem aviso</div></div>
          <button class="botao pequeno whats" id="btn-processar" type="button">Processar agora</button>
        </div>
        ${pendentes.length ? `<ul class="lista">${pendentes.slice(0, 6).map((p) => `
          <li><div class="principal"><b>${etiqueta(p.tipo, p.tipo)} ${escapar(p.nome_apelido || '')}</b>
            <span>${dataBR(p.data_referencia)} → ${escapar(p.canal)} ${escapar(p.destino)}</span></div></li>`).join('')}</ul>`
          : '<div class="aviso ok">Nenhum aviso pendente: todo alerta ja foi avisado.</div>'}
        <p class="texto-miudo" style="margin-top:12px">
          O worker roda em segundo plano (a cada poucos minutos) e procura os alertas
          sem notificacao no canal. A chave unica (alerta + canal) garante que o mesmo aviso nunca chega duas vezes.
        </p>
      </div>
    </div>
    <div class="bloco" style="margin-top:14px">
      <div class="bloco-topo"><h3>Avisos enviados</h3></div>
      ${historico}
    </div>`;

  $('#btn-add-canal').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await api('POST', '/api/canais', { tipo: $('#novo-canal').value, destino: $('#novo-destino').value });
      toast('Canal cadastrado.', 'ok');
      await navegar('whatsapp');
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      ev.currentTarget.disabled = false;
    }
  };
  document.querySelectorAll('[data-testar]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('POST', `/api/canais/${b.dataset.testar}/teste`);
        toast(r.status === 'SIMULADO' ? 'Teste registrado (modo simulado).' : 'Mensagem de teste enviada.', 'ok');
        if (r.link_whatsapp) window.open(r.link_whatsapp, '_blank', 'noopener');
        await navegar('whatsapp');
      } catch (e) {
        toast(e.message, 'erro');
      } finally {
        b.disabled = false;
      }
    };
  });
  document.querySelectorAll('[data-alternar]').forEach((b) => {
    b.onclick = async () => {
      await api('PATCH', `/api/canais/${b.dataset.alternar}`, { ativo: b.dataset.ativo !== '1' });
      await navegar('whatsapp');
    };
  });
  $('#btn-processar').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const r = await api('POST', '/api/notificacoes/processar');
      toast(`${r.enviados} enviado(s), ${r.simulados} simulado(s), ${r.erros} erro(s), ${r.pendentes} na fila.`, r.erros ? 'erro' : 'ok');
      await navegar('whatsapp');
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      ev.currentTarget.disabled = false;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Tela 06 - Ajustes (dispositivos, demonstração, regras)              */
/* ------------------------------------------------------------------ */
async function telaAjustes() {
  const [dispositivos, saude] = await Promise.all([
    api('GET', '/api/dispositivos'),
    api('GET', '/api/saude'),
  ]);

  $('#conteudo').innerHTML = `
    <div class="grade duas">
      <div class="bloco">
        <div class="bloco-topo"><h3>Dispositivos (ESP32)</h3></div>
        <table class="tabela">
          <thead><tr><th>Identificador</th><th>Apelido</th><th>Estado</th><th>Token</th></tr></thead>
          <tbody>${dispositivos.map((d) => `<tr>
            <td class="mono">${escapar(d.identificador_esp32)}</td>
            <td>${escapar(d.nome_apelido || '')}</td>
            <td>${etiqueta(d.status, d.status === 'ATIVO' ? 'ATIVO' : d.status)}</td>
            <td>${d.tem_token ? 'configurado' : '<button class="botao pequeno" data-gerar="' + d.id + '" type="button">gerar</button>'}</td>
          </tr>`).join('')}</tbody>
        </table>
        <p class="texto-miudo" style="margin-top:10px">
          Envio da leitura: <span class="mono">POST /api/leituras</span> com
          <span class="mono">{"identificador_esp32":"...","peso_total_kg":24.5}</span> e o cabecalho
          <span class="mono">X-Device-Token</span>. Peso acima de capacidade + tara + margem e recusado na hora.
        </p>
      </div>
      <div class="bloco">
        <div class="bloco-topo"><h3>Servidor e regras</h3></div>
        <dl class="dados">
          <dt>Versao</dt><dd>${escapar(saude.versao)}</dd>
          <dt>Banco</dt><dd>${escapar(saude.banco.banco)}</dd>
          <dt>Fuso</dt><dd>${escapar(saude.banco.fuso)}</dd>
          <dt>Event scheduler</dt><dd>${escapar(String(saude.banco.scheduler))}</dd>
          <dt>Canal de aviso</dt><dd>${escapar(saude.whatsapp.provedor)}</dd>
          <dt>Cheio / baixo / critico</dt><dd>${saude.regras.limiteCheioPct}% / ${saude.regras.limiteBaixoPct}%</dd>
          <dt>Offline sem leitura</dt><dd>${saude.regras.horasOffline} h</dd>
          <dt>Margem da leitura</dt><dd>${saude.regras.margemLeituraKg} kg</dd>
        </dl>
      </div>
    </div>

    <div class="bloco" style="margin-top:14px">
      <div class="bloco-topo">
        <div><h3>Ferramentas de demonstracao</h3>
          <div class="texto-miudo">${saude.demo ? 'Ligadas (DEMO_MODE=true). Desligue em producao.' : 'Desligadas (DEMO_MODE=false).'}</div></div>
      </div>
      <div class="rodape-acoes">
        <button class="botao primario pequeno" id="btn-simular" type="button" style="width:auto">Simular 14 dias de leituras</button>
        <button class="botao pequeno" id="btn-anomalia" type="button">Forcar consumo anormal</button>
        <button class="botao perigo pequeno" id="btn-limpar" type="button">Limpar dados do local</button>
      </div>
      <p class="texto-miudo" style="margin-top:10px">
        A simulacao gera leituras como o ESP32 geraria, chama as procedures do banco
        (<span class="mono">sp_reprocessar_periodo</span>) e deixa alertas prontos para o aviso no WhatsApp.
      </p>
    </div>`;

  document.querySelectorAll('[data-gerar]').forEach((b) => {
    b.onclick = async () => {
      const r = await api('POST', `/api/dispositivos/${b.dataset.gerar}/token`);
      toast(`Token gerado: ${r.token}`, 'ok');
      await navegar('ajustes');
    };
  });
  $('#btn-simular').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const r = await api('POST', '/api/demo/simular', { dias: 14, incluir_anomalia: true });
      toast(`${r.medidores.length} medidor(es) simulados, ${r.alertas.length} alerta(s) gerados.`, 'ok');
      await navegar('inicio');
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      ev.currentTarget.disabled = false;
    }
  };
  $('#btn-anomalia').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const alvo = estado.medidorSel || (estado.nivel[0] && estado.nivel[0].medidor_id) || 1;
      const r = await api('POST', '/api/demo/consumo-anormal', { medidor_id: alvo });
      toast(`Consumo de ${peso(r.consumo_kg)} em ${dataBR(r.alerta && r.alerta.data_referencia)} gerou alerta ${r.alerta ? r.alerta.tipo : ''}.`, 'ok');
      await navegar('inicio');
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      ev.currentTarget.disabled = false;
    }
  };
  $('#btn-limpar').onclick = async (ev) => {
    if (!window.confirm('Apagar leituras, consumo, alertas e avisos deste local?')) return;
    ev.currentTarget.disabled = true;
    try {
      await api('POST', '/api/demo/limpar');
      toast('Dados do local apagados.', 'ok');
      await navegar('inicio');
    } catch (e) {
      toast(e.message, 'erro');
    } finally {
      ev.currentTarget.disabled = false;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Ligações                                                           */
/* ------------------------------------------------------------------ */
const TELAS = {
  inicio: telaInicio,
  botijoes: telaBotijoes,
  trocar: telaTrocar,
  historico: telaHistorico,
  whatsapp: telaWhatsapp,
  ajustes: telaAjustes,
};

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('#login-erro');
  erro.classList.add('oculto');
  try {
    await entrar($('#email').value.trim(), $('#senha').value);
  } catch (e) {
    erro.textContent = e.message;
    erro.classList.remove('oculto');
  }
});

$('#botao-sair').addEventListener('click', sair);
document.querySelectorAll('.aba').forEach((b) => {
  b.addEventListener('click', () => navegar(b.dataset.rota));
});

(async function iniciar() {
  if (estado.token) {
    try {
      await abrirApp();
      return;
    } catch (e) {
      sair();
    }
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
