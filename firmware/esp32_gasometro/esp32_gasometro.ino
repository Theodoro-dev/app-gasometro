// =====================================================================
// Gasometro - firmware do ESP32 (Fase 3 do guia)
//
// Le o peso do botijao pela celula de carga (HX711) e envia pela rede
// Wi-Fi para a API:
//
//   POST {API_URL}/api/leituras
//   Content-Type: application/json
//   X-Device-Token: <token do medidor>
//   { "identificador_esp32": "ESP32-01", "peso_total_kg": 24.50 }
//
// A API valida a faixa, grava em tb_leituras e responde com o nivel
// calculado (percentual_restante, gas_restante_kg, status_nivel), que
// o app (PWA e Android) mostra. Mesmo contrato do scripts/simulador_esp32.js.
//
// Bibliotecas (Gerenciador de Bibliotecas da Arduino IDE):
//   - "HX711" de Bogdan Necula (bogde)
//   - "ArduinoJson" de Benoit Blanchon (v7)
// Placa: "ESP32 Dev Module" (pacote esp32 da Espressif).
// =====================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <HX711.h>
#include <time.h>

#include "config.h"

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
HX711 balanca;
Preferences memoria;          // guarda calibracao mesmo sem energia
WebServer servidorLocal(80);  // GET /status na rede local

float fatorCalibracao = FATOR_CALIBRACAO_PADRAO;
long  offsetZero      = 0;

unsigned long ultimoEnvioMs = 0;
float  ultimoPesoKg         = NAN;
float  ultimoPercentualApi  = NAN;   // valor oficial devolvido pela API
String ultimoStatusNivel    = "--";
int    ultimoHttp           = 0;

// Fila de leituras que nao conseguiram sair (Wi-Fi/API fora do ar).
struct LeituraPendente {
  float  pesoKg;
  time_t quando;
};
const int TAM_FILA = 24;     // 24 x 5 min = 2 h de folga
LeituraPendente fila[TAM_FILA];
int filaInicio = 0, filaQtd = 0;

// ---------------------------------------------------------------------
// LED: aceso = conectado; piscando = tentando conectar
// ---------------------------------------------------------------------
void led(bool ligado) { digitalWrite(PINO_LED, ligado ? HIGH : LOW); }

// ---------------------------------------------------------------------
// Celula de carga
// ---------------------------------------------------------------------
void ordenar(float *v, int n) {
  for (int i = 1; i < n; i++) {
    float x = v[i]; int j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
    v[j + 1] = x;
  }
}

// Mediana de varias leituras: ignora picos (alguem encostou no botijao).
// Retorna NAN se o HX711 nao responder.
float medirPesoKg() {
  float amostras[AMOSTRAS_POR_MEDIDA];
  int ok = 0;
  for (int i = 0; i < AMOSTRAS_POR_MEDIDA; i++) {
    if (balanca.wait_ready_timeout(500)) {
      long bruto = balanca.read();
      amostras[ok++] = (bruto - offsetZero) / fatorCalibracao;
    }
    delay(20);
  }
  if (ok < AMOSTRAS_POR_MEDIDA / 2) return NAN;
  ordenar(amostras, ok);
  float kg = amostras[ok / 2];
  if (kg < 0 && kg > -0.3f) kg = 0;   // ruido perto do zero
  return kg;
}

void carregarCalibracao() {
  memoria.begin("gasometro", true);
  fatorCalibracao = memoria.getFloat("fator", FATOR_CALIBRACAO_PADRAO);
  offsetZero      = memoria.getLong("offset", 0);
  memoria.end();
}

void salvarCalibracao() {
  memoria.begin("gasometro", false);
  memoria.putFloat("fator", fatorCalibracao);
  memoria.putLong("offset", offsetZero);
  memoria.end();
}

// ---------------------------------------------------------------------
// Wi-Fi e horario
// ---------------------------------------------------------------------
bool conectarWiFi(unsigned long limiteMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("[wifi] conectando em \"%s\"...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < limiteMs) {
    led(((millis() / 250) % 2) == 0);
    delay(50);
  }
  bool ok = WiFi.status() == WL_CONNECTED;
  led(ok);
  if (ok) Serial.printf("[wifi] conectado. IP local: %s\n", WiFi.localIP().toString().c_str());
  else    Serial.println("[wifi] sem conexao; a leitura vai para a fila.");
  return ok;
}

bool horarioValido() { return time(nullptr) > 1700000000; } // depois de 2023

// "AAAA-MM-DD HH:MM:SS" no fuso de Brasilia (formato aceito pela API)
String formatarDataHora(time_t t) {
  struct tm tmLocal;
  localtime_r(&t, &tmLocal);
  char buf[20];
  strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tmLocal);
  return String(buf);
}

// ---------------------------------------------------------------------
// Envio para a API
// ---------------------------------------------------------------------
// Retorna o codigo HTTP (ou < 0 em falha de rede).
int enviarLeitura(float pesoKg, time_t quando) {
  String url = String(API_URL) + "/api/leituras";

  JsonDocument corpo;
  corpo["identificador_esp32"] = ID_MEDIDOR;
  corpo["peso_total_kg"] = roundf(pesoKg * 100) / 100.0;   // 2 casas, igual ao DECIMAL(6,2)
  if (quando > 0) corpo["data_hora"] = formatarDataHora(quando);
  String json;
  serializeJson(corpo, json);

  HTTPClient http;
  WiFiClientSecure clienteSeguro;
  if (url.startsWith("https")) {
    clienteSeguro.setInsecure();          // sem validar certificado (projeto academico)
    http.begin(clienteSeguro, url);
  } else {
    http.begin(url);
  }
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  if (strlen(TOKEN_DISPOSITIVO) > 0) http.addHeader("X-Device-Token", TOKEN_DISPOSITIVO);

  int codigo = http.POST(json);
  String resposta = codigo > 0 ? http.getString() : "";
  http.end();
  ultimoHttp = codigo;

  if (codigo == 201) {
    JsonDocument r;
    if (!deserializeJson(r, resposta) && !r["nivel"].isNull()) {
      ultimoPercentualApi = r["nivel"]["percentual_restante"] | NAN;
      ultimoStatusNivel   = String((const char *)(r["nivel"]["status_nivel"] | "--"));
      Serial.printf("[api] %.2f kg -> nivel %.0f%% (%s), gas %.2f kg\n",
                    pesoKg, ultimoPercentualApi, ultimoStatusNivel.c_str(),
                    (float)(r["nivel"]["gas_restante_kg"] | 0.0));
    } else {
      Serial.printf("[api] %.2f kg gravado.\n", pesoKg);
    }
  } else if (codigo > 0) {
    JsonDocument r;
    deserializeJson(r, resposta);
    Serial.printf("[api] recusado (%d): %s\n", codigo, (const char *)(r["erro"] | resposta.c_str()));
  } else {
    Serial.printf("[api] falha de rede: %s\n", HTTPClient::errorToString(codigo).c_str());
  }
  return codigo;
}

// Erros que nao adianta repetir (dado ou cadastro errado): nao vao para a fila.
bool erroDefinitivo(int codigo) {
  return codigo == 400 || codigo == 401 || codigo == 404 || codigo == 409 || codigo == 422;
}

void enfileirar(float pesoKg, time_t quando) {
  if (!horarioValido()) return;   // sem hora certa, a leitura antiga nao tem valor
  int pos = (filaInicio + filaQtd) % TAM_FILA;
  if (filaQtd == TAM_FILA) filaInicio = (filaInicio + 1) % TAM_FILA;  // descarta a mais velha
  else filaQtd++;
  fila[pos] = { pesoKg, quando };
  Serial.printf("[fila] %d leitura(s) aguardando envio.\n", filaQtd);
}

void esvaziarFila() {
  while (filaQtd > 0 && WiFi.status() == WL_CONNECTED) {
    LeituraPendente &p = fila[filaInicio];
    int c = enviarLeitura(p.pesoKg, p.quando);
    if (c > 0 && (c == 201 || erroDefinitivo(c))) {
      filaInicio = (filaInicio + 1) % TAM_FILA;
      filaQtd--;
    } else {
      break;  // API caiu de novo: tenta no proximo ciclo
    }
  }
}

// Um ciclo completo: mede, envia (ou guarda) e tenta mandar o atrasado.
void cicloDeMedicao() {
  float kg = medirPesoKg();
  if (isnan(kg)) {
    Serial.println("[hx711] sem resposta: confira os fios DOUT/SCK e a alimentacao.");
    return;
  }
  ultimoPesoKg = kg;
  time_t agora = horarioValido() ? time(nullptr) : 0;

  if (!conectarWiFi(15000)) { enfileirar(kg, agora); return; }

  esvaziarFila();                       // primeiro o atrasado, em ordem
  int c = enviarLeitura(kg, agora);
  if (c <= 0 || c >= 500) enfileirar(kg, agora);
}

// ---------------------------------------------------------------------
// Servidor local: qualquer aparelho na mesma rede pode consultar
//   http://<ip-do-esp32>/status
// ---------------------------------------------------------------------
void rotaStatus() {
  JsonDocument d;
  d["identificador_esp32"] = ID_MEDIDOR;
  if (!isnan(ultimoPesoKg)) {
    d["peso_total_kg"] = roundf(ultimoPesoKg * 100) / 100.0;
    float gas = ultimoPesoKg - TARA_BOTIJAO_KG;
    if (gas < 0) gas = 0;
    float pctLocal = gas / CAPACIDADE_GAS_KG * 100.0f;
    if (pctLocal > 100) pctLocal = 100;
    d["percentual_estimado_local"] = roundf(pctLocal);
  }
  if (!isnan(ultimoPercentualApi)) d["percentual_restante_api"] = ultimoPercentualApi;
  d["status_nivel"] = ultimoStatusNivel;
  d["ultimo_http"] = ultimoHttp;
  d["leituras_na_fila"] = filaQtd;
  d["wifi_rssi_dbm"] = WiFi.RSSI();
  String s;
  serializeJson(d, s);
  servidorLocal.send(200, "application/json", s);
}

// ---------------------------------------------------------------------
// Comandos pelo Monitor Serial (115200 baud)
//   t        -> zera a balanca (sem nada em cima)
//   c 13.0   -> calibra com um peso conhecido em kg em cima
//   p        -> mostra o peso atual
//   e        -> envia uma leitura agora
//   i        -> informacoes
// ---------------------------------------------------------------------
void tratarSerial() {
  if (!Serial.available()) return;
  String linha = Serial.readStringUntil('\n');
  linha.trim();
  if (linha.length() == 0) return;
  char cmd = linha.charAt(0);

  if (cmd == 't') {
    Serial.println("[cal] zerando... deixe a plataforma vazia.");
    offsetZero = balanca.read_average(20);
    salvarCalibracao();
    Serial.printf("[cal] zero salvo (offset %ld).\n", offsetZero);
  } else if (cmd == 'c') {
    float ref = linha.substring(1).toFloat();
    if (ref <= 0) { Serial.println("[cal] uso: c 13.0  (peso conhecido em kg)"); return; }
    long bruto = balanca.read_average(20);
    fatorCalibracao = (bruto - offsetZero) / ref;
    salvarCalibracao();
    Serial.printf("[cal] fator salvo: %.2f. Peso lido agora: %.2f kg\n",
                  fatorCalibracao, medirPesoKg());
  } else if (cmd == 'p') {
    Serial.printf("[hx711] peso: %.2f kg\n", medirPesoKg());
  } else if (cmd == 'e') {
    cicloDeMedicao();
    ultimoEnvioMs = millis();
  } else if (cmd == 'i') {
    Serial.printf("medidor %s | API %s | intervalo %d s\n", ID_MEDIDOR, API_URL, INTERVALO_ENVIO_SEG);
    Serial.printf("fator %.2f | offset %ld | fila %d | wifi %s\n", fatorCalibracao, offsetZero,
                  filaQtd, WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "off");
  }
}

// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PINO_LED, OUTPUT);
  delay(300);
  Serial.println("\n=== Gasometro ESP32 ===");

  balanca.begin(PINO_HX711_DOUT, PINO_HX711_SCK);
  carregarCalibracao();
  Serial.printf("[cal] fator %.2f | offset %ld (comandos: t, c <kg>, p, e, i)\n",
                fatorCalibracao, offsetZero);

  conectarWiFi(20000);
  configTime(FUSO_SEGUNDOS, 0, NTP_SERVIDOR);   // sincroniza sozinho quando houver rede
  servidorLocal.on("/status", rotaStatus);
  servidorLocal.begin();

  cicloDeMedicao();          // primeira leitura logo ao ligar
  ultimoEnvioMs = millis();
}

void loop() {
  tratarSerial();
  servidorLocal.handleClient();

  if (millis() - ultimoEnvioMs >= (unsigned long)INTERVALO_ENVIO_SEG * 1000UL) {
    ultimoEnvioMs = millis();
    cicloDeMedicao();
  }

  // Wi-Fi caiu entre ciclos: reconecta sem travar o loop
  static unsigned long ultimaTentativa = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - ultimaTentativa > 30000) {
    ultimaTentativa = millis();
    WiFi.reconnect();
  }
  led(WiFi.status() == WL_CONNECTED);
  delay(10);
}
