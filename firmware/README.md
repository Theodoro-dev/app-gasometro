# Firmware do ESP32 — Gasômetro

Firmware que substitui o `scripts/simulador_esp32.js` pelo hardware de verdade:
o ESP32 lê o peso do botijão na célula de carga (via HX711) e envia **pelo Wi-Fi**
para a API, que calcula a porcentagem e entrega para o app (PWA/desktop e Android).

```
 Botijão ─► célula de carga ─► HX711 ─► ESP32 ──Wi-Fi──► POST /api/leituras ─► MySQL
                                           │                     │
                                           │                     └─► app: nível %, previsão, alertas, WhatsApp
                                           └─► GET http://<ip-do-esp32>/status  (consulta direta na rede local)
```

## Material

| Item | Observação |
|---|---|
| ESP32 DevKit (30 ou 38 pinos) | placa "ESP32 Dev Module" na Arduino IDE |
| Módulo HX711 | amplificador da célula de carga |
| Célula de carga | 1 célula de 50 kg (barra) **ou** 4 células de 50 kg em ponte (balança de banheiro) |
| Plataforma rígida | o botijão P13 cheio pesa ~26 kg |

## Ligações

| HX711 | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| DT (DOUT) | GPIO 16 |
| SCK | GPIO 4 |

Célula → HX711: **E+** vermelho, **E−** preto, **A−** branco, **A+** verde
(as cores mudam de fabricante para fabricante; se o peso sair negativo, inverta A+ e A−
ou use um fator de calibração negativo, que o comando `c` já resolve sozinho).

Os pinos ficam em `config.h`, caso precise trocar.

## Instalação

1. Arduino IDE → **Gerenciador de Placas**: instale `esp32` (Espressif).
2. **Gerenciador de Bibliotecas**: instale `HX711` (Bogdan Necula) e `ArduinoJson` (Benoit Blanchon, v7).
3. Abra `firmware/esp32_gasometro/esp32_gasometro.ino`.
4. Edite `config.h`:
   - `WIFI_SSID` / `WIFI_SENHA`;
   - `API_URL` → IP do PC que roda `npm start` (ex.: `http://192.168.0.10:3000`) — **não use `localhost`**, para o ESP32 isso é ele mesmo;
   - `ID_MEDIDOR` → o `identificador_esp32` cadastrado (o seed cria `ESP32-01`);
   - `TOKEN_DISPOSITIVO` → gerado no app em **Ajustes › Dispositivos**.
5. Grave na placa e abra o **Monitor Serial a 115200 baud**.

## Calibração (uma vez só, fica salva na memória do ESP32)

No Monitor Serial:

| Comando | O que faz |
|---|---|
| `t` | zera a balança — **plataforma vazia** |
| `c 13.0` | calibra — coloque um peso conhecido (ex.: botijão vazio de 13 kg, ou um peso de academia) e informe o valor em kg |
| `p` | mostra o peso atual |
| `e` | mede e envia agora, sem esperar o intervalo |
| `i` | mostra configuração, IP e fila |

Depois, opcionalmente, registre a calibração na API (`POST /api/calibracoes`).

## O que acontece a cada ciclo (padrão: 300 s)

1. Faz 15 leituras do HX711 e usa a **mediana** (ignora picos, como alguém encostando no botijão).
2. Conecta/reconecta no Wi-Fi.
3. Envia para a API:
   ```http
   POST /api/leituras
   Content-Type: application/json
   X-Device-Token: <token>

   {"identificador_esp32":"ESP32-01","peso_total_kg":24.50,"data_hora":"2026-11-12 18:30:00"}
   ```
4. A API responde `201` com o nível calculado (`percentual_restante`, `gas_restante_kg`,
   `status_nivel`), que aparece no Monitor Serial e em `/status`.
5. Se o Wi-Fi ou a API estiverem fora do ar, a leitura vai para uma **fila de 24 posições**
   (~2 h) com a hora do NTP e é enviada assim que a conexão volta. Erros de cadastro
   (`401` token errado, `404` medidor não cadastrado, `422` peso acima do teto) não são repetidos.

## Respostas da API

| Código | Significado | O que fazer |
|---|---|---|
| 201 | leitura gravada | — |
| 401 | token inválido | confira `TOKEN_DISPOSITIVO` |
| 404 | medidor não cadastrado | confira `ID_MEDIDOR` |
| 409 | medidor INATIVO | ative no app |
| 422 | peso acima de capacidade + tara + margem | recalibre (`t` e `c`) |

## Consulta direta na rede local

Qualquer celular ou PC na mesma rede pode abrir `http://<ip-do-esp32>/status`:

```json
{"identificador_esp32":"ESP32-01","peso_total_kg":21.4,"percentual_estimado_local":65,
 "percentual_restante_api":65,"status_nivel":"CHEIO","ultimo_http":201,"leituras_na_fila":0,"wifi_rssi_dbm":-58}
```

`percentual_estimado_local` usa a capacidade e a tara do `config.h` (só para diagnóstico);
o valor **oficial** é o da API, que considera a tara registrada na última troca de botijão.
