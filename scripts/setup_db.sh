#!/usr/bin/env bash
# ---------------------------------------------------------------------
# setup_db.sh - cria o banco gas, o usuario da API e roda schema + patch.
# Requer MySQL 8.0.19+ local e sudo (o schema roda como root).
# Uso: npm run db:criar
# ---------------------------------------------------------------------
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-gasometro}"
DB_PASSWORD="${DB_PASSWORD:-gasometro}"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

echo "== 1/5 Iniciando o MySQL =="
$SUDO service mysql start >/dev/null 2>&1 || true
for i in $(seq 1 30); do
  if $SUDO mysqladmin ping >/dev/null 2>&1; then break; fi
  sleep 1
done
$SUDO mysqladmin ping >/dev/null 2>&1 || { echo "ERRO: MySQL nao respondeu."; exit 1; }

echo "== 2/5 Criando o banco e aplicando o schema_v2.sql =="
$SUDO mysql < "$RAIZ/db/schema_v2.sql"

echo "== 3/5 Aplicando o patch do canal WhatsApp =="
# O patch so pode rodar uma vez: se a coluna ja existir, seguimos em frente.
if ! $SUDO mysql gas -e "SHOW COLUMNS FROM tb_notificacoes_enviadas LIKE 'provedor';" | grep -q provedor; then
  $SUDO mysql < "$RAIZ/db/patch_v3_whatsapp.sql"
  echo "   patch aplicado."
else
  echo "   patch ja estava aplicado."
fi

echo "== 4/5 Criando o usuario da API ($DB_USER) =="
$SUDO mysql <<SQL
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, SHOW VIEW ON gas.* TO '$DB_USER'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, SHOW VIEW ON gas.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

echo "== 5/5 Conferindo =="
$SUDO mysql gas -e "SHOW EVENTS;" | sed -n '1,6p'
$SUDO mysql gas -e "SELECT routine_type, COUNT(*) AS total FROM information_schema.routines WHERE routine_schema='gas' GROUP BY routine_type;"
echo "Banco pronto. Proximo passo: npm install && npm run seed && npm start"