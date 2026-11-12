// =====================================================================
// config.h - tudo o que muda de uma instalacao para outra fica aqui.
// Copie os valores da tela Ajustes do app (identificador e token).
// =====================================================================
#pragma once

// ---------- Wi-Fi ----------
#define WIFI_SSID        "NOME_DA_SUA_REDE"
#define WIFI_SENHA       "SENHA_DA_SUA_REDE"

// ---------- API do Gasometro ----------
// IP do computador onde roda `npm start` (mesma rede do ESP32) ou a URL publica.
// Ex.: "http://192.168.0.10:3000"  ou  "https://meu-servidor.com"
#define API_URL          "http://192.168.0.10:3000"

// Igual ao campo identificador_esp32 do medidor cadastrado (tb_medidores).
#define ID_MEDIDOR       "ESP32-01"

// Token gerado em Ajustes > Dispositivos (POST /api/dispositivos/:id/token).
// Deixe "" se o medidor ainda nao tiver token configurado.
#define TOKEN_DISPOSITIVO ""

// ---------- Envio ----------
// Mesmo valor padrao de tb_medidores.intervalo_envio_seg (300 s = 5 min).
// O banco marca OFFLINE apos 2 h sem leitura, entao nao passe de ~1 h.
#define INTERVALO_ENVIO_SEG   300

// ---------- HX711 (celula de carga) ----------
#define PINO_HX711_DOUT  16
#define PINO_HX711_SCK   4

// Fator de calibracao inicial. O valor real e gravado na memoria
// pelo comando "c" no Monitor Serial (veja o README do firmware).
#define FATOR_CALIBRACAO_PADRAO  -21500.0f

// Quantas leituras do HX711 compoem uma medida (usa a mediana).
#define AMOSTRAS_POR_MEDIDA  15

// ---------- Botijao (so para o log local; a API faz a conta oficial) ----------
#define CAPACIDADE_GAS_KG    13.0f   // P13
#define TARA_BOTIJAO_KG      13.0f   // peso do botijao vazio (veja o casco)

// ---------- Horario (NTP) ----------
// Com horario sincronizado, leituras feitas sem Wi-Fi ficam guardadas
// e sao enviadas depois com a hora certa (campo data_hora).
#define NTP_SERVIDOR     "pool.ntp.org"
#define FUSO_SEGUNDOS    (-3 * 3600)  // Brasilia, igual ao time_zone do banco

// ---------- LED de status ----------
#define PINO_LED         2   // LED azul da maioria das placas DevKit
