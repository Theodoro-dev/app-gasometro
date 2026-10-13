-- =====================================================================
-- teste_schema_v2.sql - dados ficticios para validar o schema_v2.sql
-- Rode num banco de desenvolvimento (nao no de producao):
--   mysql -u root -p < schema_v2.sql
--   mysql -u root -p gas < teste_schema_v2.sql
-- Depois de conferir, apague tudo: DROP DATABASE gas; e rode o schema de novo.
-- =====================================================================

USE gas;

INSERT INTO tb_locais (id, nome_local, tipo_local)
VALUES (1, 'Casa de teste', 'RESIDENCIAL');

INSERT INTO tb_medidores
    (id, local_id, identificador_esp32, capacidade_botijao_kg,
     peso_vazio_botijao_kg, nome_apelido)
VALUES
    (1, 1, 'ESP32-T1', 13.00, 13.00, 'M1 - vermelho'),
    (2, 1, 'ESP32-T2', 13.00, 13.00, 'M2 - amarelo'),
    (3, 1, 'ESP32-T3', 13.00, 13.00, 'M3 - media zero'),
    (4, 1, 'ESP32-T4', 13.00, 13.00, 'M4 - dia de troca'),
    (5, 1, 'ESP32-T5', 13.00, 13.00, 'M5 - uma leitura');

-- Historico: de 8 a 2 dias atras (7 dias), duas leituras por dia.
-- M1, M2, M4 consomem 1,00 kg/dia. M3 nao consome nada.
INSERT INTO tb_leituras (medidor_id, data_hora, peso_total_kg)
WITH RECURSIVE n AS (
    SELECT 2 AS d
    UNION ALL
    SELECT d + 1 FROM n WHERE d < 8
),
m AS (
    SELECT 1 AS id, 25.00 AS manha, 24.00 AS noite
    UNION ALL SELECT 2, 25.00, 24.00
    UNION ALL SELECT 3, 20.00, 20.00
    UNION ALL SELECT 4, 25.00, 24.00
)
SELECT m.id, TIMESTAMP(CURDATE() - INTERVAL n.d DAY, '08:00:00'), m.manha FROM n, m
UNION ALL
SELECT m.id, TIMESTAMP(CURDATE() - INTERVAL n.d DAY, '20:00:00'), m.noite FROM n, m;

-- Ontem
INSERT INTO tb_leituras (medidor_id, data_hora, peso_total_kg) VALUES
    -- M1: consumo 2,50 kg (> 2 x 1,00)           -> VERMELHO
    (1, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '08:00:00'), 25.00),
    (1, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '20:00:00'), 22.50),
    -- M2: consumo 1,70 kg (> 1,5 e <= 2)           -> AMARELO
    (2, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '08:00:00'), 25.00),
    (2, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '20:00:00'), 23.30),
    -- M3: consumo 0,00 com media 0                 -> SEM alerta
    (3, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '08:00:00'), 20.00),
    (3, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '20:00:00'), 20.00),
    -- M4: troca as 13:00; consumo real 1,00 + 0,50    -> 1,50, SEM alerta
    (4, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '08:00:00'), 20.00),
    (4, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '12:00:00'), 19.00),
    (4, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '14:00:00'), 26.00),
    (4, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '20:00:00'), 25.50),
    -- M5: leitura unica                            -> consumo NULL
    (5, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '08:00:00'), 24.00);

INSERT INTO tb_trocas_botijao
    (medidor_id, data_hora, peso_botijao_novo_kg, tara_botijao_kg)
VALUES (4, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '13:00:00'), 26.00, 13.00);

-- Processa de 8 dias atras ate ontem
CALL sp_reprocessar_periodo(CURDATE() - INTERVAL 8 DAY, CURDATE() - INTERVAL 1 DAY);

-- TESTE 1: consumo de ontem
-- Esperado: M1=2.50 M2=1.70 M3=0.00 M4=1.50 M5=NULL
SELECT medidor_id, peso_inicio_dia_kg, peso_fim_dia_kg, consumo_kg
FROM tb_consumo_diario
WHERE data = CURDATE() - INTERVAL 1 DAY
ORDER BY medidor_id;

-- TESTE 2: alertas
-- Esperado: exatamente 2 linhas: M1 VERMELHO e M2 AMARELO
SELECT medidor_id, tipo, data_referencia FROM tb_alertas ORDER BY medidor_id;

-- TESTE 3: rodar de novo nao duplica
-- Esperado: continua 2 linhas
CALL sp_gerar_alertas(CURDATE() - INTERVAL 1 DAY);
CALL sp_gerar_alertas(CURDATE() - INTERVAL 1 DAY);
SELECT COUNT(*) AS total_alertas FROM tb_alertas;

-- TESTE 4: nivel atual (M4 usa a tara 13,00 da troca)
-- Esperado: M1 9.50 kg (73%) M2 10.30 (79%) M3 7.00 (54%)
--           M4 12.50 (96%)    M5 11.00 (85%) - todos CHEIO
SELECT medidor_id, peso_total_kg, gas_restante_kg, percentual_restante, status_nivel
FROM vw_nivel_atual ORDER BY medidor_id;

-- TESTE 5: media e previsao (a media dos ultimos 7 dias inclui ontem)
-- Esperado: M1 media 1.21; M2 media 1.10; M3 media 0.00 (sem previsao);
--           M4 media 1.07; M5 sem media
SELECT medidor_id, media_consumo_dia, dias_estimados_restantes, data_estimada_troca
FROM vw_previsao_troca ORDER BY medidor_id;

-- TESTE 6: integridade (cada comando abaixo DEVE dar erro)
-- INSERT INTO tb_leituras (medidor_id, data_hora, peso_total_kg)
--     VALUES (1, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '08:00:00'), 20); -- duplicada
-- INSERT INTO tb_medidores (local_id, identificador_esp32, capacidade_botijao_kg,
--     peso_vazio_botijao_kg) VALUES (1, 'ESP32-T1', 13, 13);              -- ESP32 repetido
-- INSERT INTO tb_leituras (medidor_id, peso_total_kg) VALUES (1, -5);     -- peso negativo
-- INSERT INTO tb_leituras (medidor_id, peso_total_kg) VALUES (999, 10);   -- medidor inexistente