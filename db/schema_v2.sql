-- =====================================================================
-- Gasometro - schema_v2.sql (corrigido)
-- Requer MySQL 8.0.19+ (CHECK, window functions, CTE).
-- Para banco ja existente: faca backup e rode DROP DATABASE gas antes.
-- =====================================================================

-- Rode como administrador, uma vez (e ponha event_scheduler=ON no my.cnf):
--   SET GLOBAL event_scheduler = ON;
-- No my.cnf, para o servidor usar o horario de Brasilia:
--   default-time-zone = '-03:00'

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS gas
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE gas;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tb_locais (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome_local VARCHAR(200) NOT NULL,
    tipo_local VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tipo_local
        CHECK (tipo_local IN ('RESIDENCIAL', 'INDUSTRIAL'))
);

CREATE TABLE IF NOT EXISTS tb_medidores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    local_id INT NOT NULL,
    identificador_esp32 VARCHAR(100) NOT NULL,
    capacidade_botijao_kg DECIMAL(6,2) NOT NULL,   -- kg de gas (ex.: 13.00)
    peso_vazio_botijao_kg DECIMAL(6,2) NOT NULL,   -- tara do botijao inicial
    nome_apelido VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_medidor_esp32 UNIQUE (identificador_esp32),

    CONSTRAINT fk_medidores_local
        FOREIGN KEY (local_id) REFERENCES tb_locais(id),

    CONSTRAINT chk_capacidade_botijao CHECK (capacidade_botijao_kg > 0),
    CONSTRAINT chk_peso_vazio         CHECK (peso_vazio_botijao_kg >= 0),
    CONSTRAINT chk_status_medidor
        CHECK (status IN ('ATIVO', 'INATIVO', 'OFFLINE'))
);

CREATE TABLE IF NOT EXISTS tb_leituras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    medidor_id INT NOT NULL,
    data_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    peso_total_kg DECIMAL(6,2) NOT NULL,

    -- impede duas leituras do mesmo medidor no mesmo instante
    CONSTRAINT uq_leitura UNIQUE (medidor_id, data_hora),

    CONSTRAINT fk_leituras_medidor
        FOREIGN KEY (medidor_id) REFERENCES tb_medidores(id),

    CONSTRAINT chk_peso_total CHECK (peso_total_kg >= 0)
);

CREATE TABLE IF NOT EXISTS tb_trocas_botijao (
    id INT AUTO_INCREMENT PRIMARY KEY,
    medidor_id INT NOT NULL,
    data_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    peso_botijao_novo_kg DECIMAL(6,2) NOT NULL,    -- peso total logo apos a troca
    tara_botijao_kg DECIMAL(6,2) NULL,             -- tara do botijao novo (opcional)

    CONSTRAINT uq_troca UNIQUE (medidor_id, data_hora),
    CONSTRAINT fk_trocas_medidor
        FOREIGN KEY (medidor_id) REFERENCES tb_medidores(id),

    CONSTRAINT chk_peso_troca CHECK (peso_botijao_novo_kg >= 0),
    CONSTRAINT chk_tara_troca CHECK (tara_botijao_kg IS NULL OR tara_botijao_kg >= 0)
);

CREATE TABLE IF NOT EXISTS tb_consumo_diario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    medidor_id INT NOT NULL,
    data DATE NOT NULL,
    peso_inicio_dia_kg DECIMAL(6,2),
    peso_fim_dia_kg DECIMAL(6,2),
    consumo_kg DECIMAL(6,2),                         -- NULL = dia sem dados suficientes
    dia_util BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_consumo_medidor_data UNIQUE (medidor_id, data),

    CONSTRAINT fk_consumo_medidor
        FOREIGN KEY (medidor_id) REFERENCES tb_medidores(id),

    CONSTRAINT chk_consumo CHECK (consumo_kg IS NULL OR consumo_kg >= 0)
);

CREATE TABLE IF NOT EXISTS tb_usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    local_id INT NOT NULL,
    email VARCHAR(200) NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_usuario_email UNIQUE (email),

    CONSTRAINT fk_usuario_local
        FOREIGN KEY (local_id) REFERENCES tb_locais(id)
);

CREATE TABLE IF NOT EXISTS tb_canais_notificacao (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    destino VARCHAR(255) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_canal UNIQUE (usuario_id, tipo, destino),

    CONSTRAINT fk_canais_usuario
        FOREIGN KEY (usuario_id) REFERENCES tb_usuarios(id),

    CONSTRAINT chk_tipo_canal CHECK (tipo IN ('PUSH', 'EMAIL', 'SMS'))
);

CREATE TABLE IF NOT EXISTS tb_alertas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    medidor_id INT NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    data_referencia DATE NOT NULL,                 -- dia de consumo que gerou o alerta
    data_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- no maximo um alerta por medidor por dia: o proprio banco evita duplicar
    CONSTRAINT uq_alerta_dia UNIQUE (medidor_id, data_referencia),

    CONSTRAINT fk_alertas_medidor
        FOREIGN KEY (medidor_id) REFERENCES tb_medidores(id),

    CONSTRAINT chk_tipo_alerta CHECK (tipo IN ('VERMELHO', 'AMARELO'))
);

CREATE TABLE IF NOT EXISTS tb_notificacoes_enviadas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    alerta_id INT NOT NULL,
    canal_id INT NOT NULL,
    data_hora_envio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_notif UNIQUE (alerta_id, canal_id),

    CONSTRAINT fk_notif_alerta
        FOREIGN KEY (alerta_id) REFERENCES tb_alertas(id),

    CONSTRAINT fk_notif_canal
        FOREIGN KEY (canal_id) REFERENCES tb_canais_notificacao(id)
);

CREATE TABLE IF NOT EXISTS tb_calibracoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    medidor_id INT NOT NULL,
    data_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    peso_referencia_kg DECIMAL(6,2) NOT NULL,

    CONSTRAINT fk_calibracoes_medidor
        FOREIGN KEY (medidor_id) REFERENCES tb_medidores(id),

    CONSTRAINT chk_peso_referencia CHECK (peso_referencia_kg >= 0),

    KEY idx_calibracoes_medidor_data (medidor_id, data_hora)
);

-- ---------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------

-- Nivel atual: ultima leitura de cada medidor. Usa a tara do ultimo botijao
-- trocado (se informada); senao, a tara cadastrada no medidor.
-- status_nivel: limites 50% e 15% sao SUGESTAO (o mockup nao define numeros).
CREATE OR REPLACE VIEW vw_nivel_atual AS
SELECT
    b.medidor_id,
    b.local_id,
    b.nome_apelido,
    b.capacidade_botijao_kg,
    b.tara_kg AS peso_vazio_botijao_kg,
    b.data_hora_leitura,
    b.peso_total_kg,
    b.gas_restante_kg,
    b.percentual_restante,
    CASE
        WHEN b.percentual_restante >= 50 THEN 'CHEIO'
        WHEN b.percentual_restante >= 15 THEN 'BAIXO'
        ELSE 'CRITICO'
    END AS status_nivel
FROM (
    SELECT
        m.id AS medidor_id,
        m.local_id,
        m.nome_apelido,
        m.capacidade_botijao_kg,
        COALESCE(tr.tara_botijao_kg, m.peso_vazio_botijao_kg) AS tara_kg,
        ul.data_hora AS data_hora_leitura,
        ul.peso_total_kg,
        ROUND(GREATEST(
            ul.peso_total_kg
            - COALESCE(tr.tara_botijao_kg, m.peso_vazio_botijao_kg), 0), 2)
            AS gas_restante_kg,
        ROUND(LEAST(GREATEST(
            (ul.peso_total_kg
             - COALESCE(tr.tara_botijao_kg, m.peso_vazio_botijao_kg))
            / m.capacidade_botijao_kg * 100, 0), 100), 0)
            AS percentual_restante
    FROM tb_medidores m
    JOIN (
        SELECT medidor_id, data_hora, peso_total_kg
        FROM (
            SELECT l.medidor_id, l.data_hora, l.peso_total_kg,
                    ROW_NUMBER() OVER (
                        PARTITION BY l.medidor_id ORDER BY l.data_hora DESC
                    ) AS rn
            FROM tb_leituras l
        ) x
        WHERE x.rn = 1
    ) ul ON ul.medidor_id = m.id
    LEFT JOIN (
        SELECT medidor_id, tara_botijao_kg
        FROM (
            SELECT t.medidor_id, t.tara_botijao_kg,
                    ROW_NUMBER() OVER (
                        PARTITION BY t.medidor_id ORDER BY t.data_hora DESC
                    ) AS rn
            FROM tb_trocas_botijao t
        ) y
        WHERE y.rn = 1
    ) tr ON tr.medidor_id = m.id
) b;

-- Media de consumo dos ultimos 7 dias completos (hoje nao entra).
CREATE OR REPLACE VIEW vw_media_consumo AS
SELECT
    medidor_id,
    ROUND(AVG(consumo_kg), 2) AS media_consumo_dia
FROM tb_consumo_diario
WHERE data >= CURDATE() - INTERVAL 7 DAY
  AND data < CURDATE()
  AND consumo_kg IS NOT NULL
GROUP BY medidor_id;

CREATE OR REPLACE VIEW vw_previsao_troca AS
SELECT
    n.medidor_id,
    n.local_id,
    n.nome_apelido,
    n.peso_total_kg,
    n.gas_restante_kg,
    n.percentual_restante,
    n.status_nivel,
    m.media_consumo_dia,
    CASE
        WHEN m.media_consumo_dia > 0
        THEN ROUND(n.gas_restante_kg / m.media_consumo_dia, 0)
    END AS dias_estimados_restantes,
    CASE
        WHEN m.media_consumo_dia > 0
        THEN DATE_ADD(CURDATE(),
                      INTERVAL ROUND(n.gas_restante_kg / m.media_consumo_dia, 0) DAY)
    END AS data_estimada_troca
FROM vw_nivel_atual n
LEFT JOIN vw_media_consumo m ON m.medidor_id = n.medidor_id;

-- ---------------------------------------------------------------------
-- PROCEDURES
-- ---------------------------------------------------------------------

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_calcular_consumo_diario$$
DROP PROCEDURE IF EXISTS sp_gerar_alertas$$
DROP PROCEDURE IF EXISTS sp_reprocessar_periodo$$
DROP PROCEDURE IF EXISTS sp_atualizar_status_medidores$$

-- Consumo do dia p_data. Se houve troca de botijao no dia, o dia e dividido em
-- trechos (antes/depois da troca); cada trecho consome (primeira - ultima leitura)
-- e os trechos sao somados. Com menos de 2 leituras no dia, consumo_kg = NULL.
CREATE PROCEDURE sp_calcular_consumo_diario(IN p_data DATE)
BEGIN
    DECLARE v_ini DATETIME;
    DECLARE v_fim DATETIME;

    SET v_ini = CAST(p_data AS DATETIME);
    SET v_fim = v_ini + INTERVAL 1 DAY;

    INSERT INTO tb_consumo_diario
        (medidor_id, data, peso_inicio_dia_kg, peso_fim_dia_kg, consumo_kg, dia_util)
    WITH leituras_dia AS (
        SELECT
            lt.medidor_id,
            lt.data_hora,
            lt.peso_total_kg,
            (SELECT COUNT(*)
                FROM tb_trocas_botijao t
               WHERE t.medidor_id = lt.medidor_id
                 AND t.data_hora >= v_ini
                 AND t.data_hora <= lt.data_hora) AS trecho
        FROM tb_leituras lt
        WHERE lt.data_hora >= v_ini
          AND lt.data_hora < v_fim
    ),
    ordenadas AS (
        SELECT
            medidor_id, trecho, peso_total_kg,
            ROW_NUMBER() OVER (PARTITION BY medidor_id, trecho
                                ORDER BY data_hora)      AS pos_trecho_ini,
            ROW_NUMBER() OVER (PARTITION BY medidor_id, trecho
                                ORDER BY data_hora DESC) AS pos_trecho_fim,
            ROW_NUMBER() OVER (PARTITION BY medidor_id
                                ORDER BY data_hora)      AS pos_dia_ini,
            ROW_NUMBER() OVER (PARTITION BY medidor_id
                                ORDER BY data_hora DESC) AS pos_dia_fim,
            COUNT(*) OVER (PARTITION BY medidor_id)      AS qtd_leituras
        FROM leituras_dia
    ),
    por_trecho AS (
        SELECT
            medidor_id, trecho,
            MAX(CASE WHEN pos_trecho_ini = 1 THEN peso_total_kg END)
          - MAX(CASE WHEN pos_trecho_fim = 1 THEN peso_total_kg END) AS queda_kg
        FROM ordenadas
        GROUP BY medidor_id, trecho
    ),
    consumo AS (
        SELECT medidor_id, SUM(GREATEST(queda_kg, 0)) AS total_kg
        FROM por_trecho
        GROUP BY medidor_id
    ),
    dia AS (
        SELECT
             medidor_id,
             MAX(CASE WHEN pos_dia_ini = 1 THEN peso_total_kg END) AS peso_inicio,
             MAX(CASE WHEN pos_dia_fim = 1 THEN peso_total_kg END) AS peso_fim,
             MAX(qtd_leituras) AS qtd_leituras
        FROM ordenadas
        GROUP BY medidor_id
    )
    SELECT
        d.medidor_id,
        p_data,
        d.peso_inicio,
        d.peso_fim,
        CASE WHEN d.qtd_leituras >= 2 THEN ROUND(c.total_kg, 2) END,
        DAYOFWEEK(p_data) BETWEEN 2 AND 6
    FROM dia d
    JOIN consumo c ON c.medidor_id = d.medidor_id
    ON DUPLICATE KEY UPDATE
        peso_inicio_dia_kg = VALUES(peso_inicio_dia_kg),
        peso_fim_dia_kg     = VALUES(peso_fim_dia_kg),
        consumo_kg          = VALUES(consumo_kg),
        dia_util            = VALUES(dia_util);
END$$

-- Alertas do dia p_data. Base de comparacao: media dos 7 dias anteriores,
-- exigindo ao menos 3 dias de historico e media > 0.
--    AMARELO : consumo > 1,5 x media
--    VERMELHO: consumo > 2,0 x media
-- Rodar duas vezes nao duplica (UNIQUE medidor_id + data_referencia).
CREATE PROCEDURE sp_gerar_alertas(IN p_data DATE)
BEGIN
    INSERT INTO tb_alertas (medidor_id, tipo, data_referencia, data_hora)
    SELECT
         c.medidor_id,
         CASE
              WHEN c.consumo_kg > b.media_kg * 2 THEN 'VERMELHO'
              ELSE 'AMARELO'
         END,
         p_data,
         NOW()
    FROM tb_consumo_diario c
    JOIN (
         SELECT medidor_id, AVG(consumo_kg) AS media_kg
         FROM tb_consumo_diario
         WHERE data >= p_data - INTERVAL 7 DAY
           AND data < p_data
           AND consumo_kg IS NOT NULL
         GROUP BY medidor_id
         HAVING COUNT(*) >= 3 AND AVG(consumo_kg) > 0
    ) b ON b.medidor_id = c.medidor_id
    WHERE c.data = p_data
       AND c.consumo_kg > b.media_kg * 1.5
    ON DUPLICATE KEY UPDATE
         tipo = VALUES(tipo);
END$$

-- Recalcula consumo e alertas de um periodo (dias perdidos, correcoes).
CREATE PROCEDURE sp_reprocessar_periodo(IN p_ini DATE, IN p_fim DATE)
BEGIN
    DECLARE v_dia DATE;

    SET v_dia = p_ini;
    WHILE v_dia <= p_fim DO
        CALL sp_calcular_consumo_diario(v_dia);
        CALL sp_gerar_alertas(v_dia);
        SET v_dia = v_dia + INTERVAL 1 DAY;
    END WHILE;
END$$

-- ATIVO -> OFFLINE se nao houver leitura nas ultimas p_horas horas, e volta
-- para ATIVO quando voltar a enviar. INATIVO nunca e alterado.
CREATE PROCEDURE sp_atualizar_status_medidores(IN p_horas INT)
BEGIN
    UPDATE tb_medidores m
        SET m.status = 'OFFLINE'
      WHERE m.status = 'ATIVO'
        AND m.created_at < NOW() - INTERVAL p_horas HOUR
        AND NOT EXISTS (
             SELECT 1 FROM tb_leituras l
              WHERE l.medidor_id = m.id
                AND l.data_hora >= NOW() - INTERVAL p_horas HOUR);

    UPDATE tb_medidores m
        SET m.status = 'ATIVO'
      WHERE m.status = 'OFFLINE'
        AND EXISTS (
             SELECT 1 FROM tb_leituras l
              WHERE l.medidor_id = m.id
                AND l.data_hora >= NOW() - INTERVAL p_horas HOUR);
END$$

-- ---------------------------------------------------------------------
-- EVENTOS (o evento roda no fuso definido na hora da criacao)
-- ---------------------------------------------------------------------

SET time_zone = '-03:00'$$

DROP EVENT IF EXISTS ev_processar_consumo_diario$$
CREATE EVENT ev_processar_consumo_diario
    ON SCHEDULE EVERY 1 DAY
    STARTS TIMESTAMP(CURDATE() + INTERVAL 1 DAY, '00:10:00')
DO
BEGIN
    CALL sp_calcular_consumo_diario(CURDATE() - INTERVAL 1 DAY);
    CALL sp_gerar_alertas(CURDATE() - INTERVAL 1 DAY);
END$$

DROP EVENT IF EXISTS ev_verificar_medidores_offline$$
CREATE EVENT ev_verificar_medidores_offline
    ON SCHEDULE EVERY 1 HOUR
DO
BEGIN
    CALL sp_atualizar_status_medidores(2);   -- 2 horas: ajuste ao intervalo do ESP32
END$$

DELIMITER ;