-- ---------------------------------------------------------------------
-- usuario_api.sql - usuario que a API usa para falar com o banco.
-- Usado pelo docker-compose (roda so na primeira subida do volume).
-- No modo local, o scripts/setup_db.sh cria o mesmo usuario.
-- ---------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'gasometro'@'%' IDENTIFIED BY 'gasometro';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, SHOW VIEW ON gas.* TO 'gasometro'@'%';
FLUSH PRIVILEGES;