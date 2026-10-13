# Arquitetura do Gasômetro

## Fluxo de ponta a ponta

```
   ESP32 + HX711 (célula de carga)
              │  POST /api/leituras  { identificador_esp32, peso_total_kg }
              │  X-Device-Token: <token do medidor>
              ▼
      ┌───────────────────┐        ┌──────────────────────────────┐
      │  API (Express)    │──────▶ │  MySQL 8 (banco gas)         │
      │  valida faixa,    │        │  tb_leituras                 │
      │  autentica token  │        │  tb_trocas_botijao           │
      └───────────────────┘        │  procedures + eventos:       │
              ▲                    │   sp_calcular_consumo_diario │
              │  REST + JWT        │   sp_gerar_alertas           │
              │                    │   sp_atualizar_status_*      │
      ┌───────┴────────┐           │  views:                      │
      │  App (PWA)     │◀──────────│   vw_nivel_atual             │
      │  6 telas       │           │   vw_media_consumo           │
      └────────────────┘           │   vw_previsao_troca          │
              ▲                    └──────────────────────────────┘
              │                          ▲   alertas às 00:10
              │  avisos enviados         │
      ┌───────┴──────────────────────────┴───────────────────────┐
      │  Worker de notificações (na API, a cada 60 s)            │
      │  pendentes → envia WhatsApp → tb_notificacoes_enviadas   │
      │  falhou? tb_whatsapp_fila (reenvio até N tentativas)     │
      └──────────────────────────────────────────────────────────┘
                                │
                     WhatsApp Cloud API (Meta) / Twilio
                     ou modo simulado (link wa.me)
```

## Por que a API fica no meio

Decisão do próprio guia (Fase 4): se o app falasse direto com o MySQL, a senha do banco viajaria
dentro do aplicativo. A API autentica o usuário (JWT), guarda a senha do banco só no servidor e
**filtra tudo pelo `local_id` do usuário** — nenhuma consulta sai da API sem esse filtro
(`routes/medidores.js`, `routes/alertas.js`, `routes/canais.js`, `routes/notificacoes.js`).

## Quem calcula o quê

| Cálculo | Onde roda | Por quê |
|---|---|---|
| Consumo do dia (com trechos por causa da troca) | `sp_calcular_consumo_diario` no banco | uma única fonte de verdade, repetível |
| Média de 7 dias | view `vw_media_consumo` | já ignora o dia atual e dias sem dados |
| Nível, percentual e status | view `vw_nivel_atual` | usa a tara da última troca quando existe |
| Previsão de troca | view `vw_previsao_troca` | dias estimados e data |
| Alertas AMARELO/VERMELHO | `sp_gerar_alertas` | média > 0, mínimo de 3 dias, `>` e não `>=` |
| Status OFFLINE do medidor | `sp_atualizar_status_medidores` | evento horário |
| Validação de peso absurdo | API (`routes/leituras.js`) | um CHECK não cruza tabelas |
| Texto e envio do aviso | API (`services/whatsapp.js`, `notificacoes.js`) | canal externo, fora do banco |

A API **não recalcula regra de negócio**: ela lê as views e chama as procedures. Isso mantém os
números do app iguais aos do OLAP.

## Idempotência (o que o guia chamava de "automatização confiável")

| Situação | Garantia |
|---|---|
| Rodar `sp_gerar_alertas` várias vezes | `UNIQUE (medidor_id, data_referencia)` + `ON DUPLICATE KEY UPDATE` |
| Rodar o ETL/consumo de novo no mesmo dia | `UNIQUE (medidor_id, data)` na `tb_consumo_diario` |
| Mesma leitura enviada duas vezes | `UNIQUE (medidor_id, data_hora)` na `tb_leituras` |
| Mesmo aviso enviado duas vezes | `UNIQUE (alerta_id, canal_id)` na `tb_notificacoes_enviadas` |
| Provedor de WhatsApp fora do ar | `tb_whatsapp_fila` com contagem de tentativas |
| Reinício do app | nada em memória: a fila está no banco |

## Segurança

- Senha do usuário em **bcrypt**; sessão em **JWT** com validade configurável.
- Dispositivo autenticado por **token por medidor** (`X-Device-Token`, comparação em tempo constante).
- Entrada validada: peso negativo, peso acima do teto, telefone fora do padrão DDI+DDD+número,
  `tipo_local` e `tipo_canal` restritos por `CHECK` no banco.
- Modo `simulado` por padrão: nada sai para a internet sem credencial explícita.
- `DEMO_MODE=false` desliga as rotas de simulação em produção.

## Limites conhecidos

- O modelo OLAP da seção 6 do guia não foi carregado ainda: a tela "Por mês" agrega direto do OLTP
  (`/api/medidores/relatorios/consumo-mensal`), que é o mesmo total, só sem o ETL.
- Não há tela de cadastro de medidores/usuários (o `seed` faz isso); o guia também não previa.
- Sem refresh token: expirou o JWT, o app pede login de novo.