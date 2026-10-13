-- =====================================================================
-- patch_v3_whatsapp.sql - Gasometro com aviso por WhatsApp
-- Rode DEPOIS do schema_v2.sql, uma unica vez:
--   mysql -u root -p < db/schema_v2.sql
--   mysql -u root -p < db/patch_v3_whatsapp.sql
-- O que faz:
--   1. permite o canal WHATSAPP em tb_canais_notificacao;
--   2. cria a trilha de envio (provedor, modo, status, link, mensagem, erro);
--   3. cria a fila de reenvio (outbox) quando o provedor esta indisponivel;
--   4. adiciona o token do dispositivo usado pelo ESP32 no endpoint de leitura;
--   5. cria os indices que a varredura de notificacoes pendentes usa.
-- =====================================================================

USE gas;

-- 1. Canal WHATSAPP ---------------------------------------------------
ALTER TABLE tb_canais_notificacao DROP CHECK chk_tipo_canal;
ALTER TABLE tb_canais_notificacao
    ADD CONSTRAINT chk_tipo_canal
        CHECK (tipo IN ('PUSH', 'EMAIL', 'SMS', 'WHATSAPP'));

-- 2. Trilha de envio --------------------------------------------------
ALTER TABLE tb_notificacoes_enviadas
    ADD COLUMN provedor     VARCHAR(20)  NULL AFTER canal_id,
    ADD COLUMN modo         VARCHAR(20)  NULL AFTER provedor,   -- API | SIMULADO | LINK
    ADD COLUMN status       VARCHAR(20)  NOT NULL DEFAULT 'ENVIADO' AFTER modo,
    ADD COLUMN mensagem     TEXT         NULL AFTER status,     -- texto enviado
    ADD COLUMN link_whatsapp VARCHAR(512) NULL AFTER mensagem,  -- wa.me de fallback
    ADD COLUMN erro         VARCHAR(500) NULL AFTER link_whatsapp,
    ADD COLUMN tentativas   INT          NOT NULL DEFAULT 1 AFTER erro;

ALTER TABLE tb_notificacoes_enviadas
    ADD CONSTRAINT chk_status_notif
        CHECK (status IN ('ENVIADO', 'SIMULADO', 'PENDENTE', 'ERRO'));

-- 3. Fila de reenvio --------------------------------------------------
-- Quando o provedor falha, a notificacao fica PENDENTE e o worker tenta
-- de novo. A chave unica (alerta_id, canal_id) segue sendo a garantia de
-- que o mesmo aviso nunca chega duas vezes ao usuario.
CREATE TABLE IF NOT EXISTS tb_whatsapp_fila (
    id INT AUTO_INCREMENT PRIMARY KEY,
    alerta_id INT NOT NULL,
    canal_id INT NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tentativas INT NOT NULL DEFAULT 0,
    ultima_tentativa TIMESTAMP NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',

    CONSTRAINT uq_fila_alerta_canal UNIQUE (alerta_id, canal_id),
    CONSTRAINT fk_fila_alerta FOREIGN KEY (alerta_id) REFERENCES tb_alertas(id),
    CONSTRAINT fk_fila_canal  FOREIGN KEY (canal_id)  REFERENCES tb_canais_notificacao(id),
    CONSTRAINT chk_fila_status CHECK (status IN ('PENDENTE', 'ENVIADO', 'DESISTIU')),

    KEY idx_fila_status (status, criado_em)
);

-- 4. Token do dispositivo (ESP32) -------------------------------------
-- Opcional: se preenchido, o endpoint POST /api/leituras exige o
-- cabecalho X-Device-Token com este valor.
ALTER TABLE tb_medidores
    ADD COLUMN token_dispositivo VARCHAR(64) NULL AFTER nome_apelido,
    ADD COLUMN intervalo_envio_seg INT NOT NULL DEFAULT 300 AFTER token_dispositivo;

-- 5. Indices de apoio -------------------------------------------------
CREATE INDEX idx_alertas_data       ON tb_alertas (data_referencia, tipo);
CREATE INDEX idx_notif_status       ON tb_notificacoes_enviadas (status, data_hora_envio);
-- Nao criamos indice em tb_leituras(medidor_id, data_hora): o UNIQUE
-- uq_leitura ja cobre exatamente essas colunas.
