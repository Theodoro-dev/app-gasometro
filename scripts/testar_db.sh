#!/usr/bin/env bash
# ---------------------------------------------------------------------
# testar_db.sh - Fase 2 do guia: valida o schema com dados ficticios.
# Cria um banco descartavel (gas_teste), roda o teste_schema_v2.sql e
# confere cada resultado contra o "Esperado" escrito no proprio script.
# Uso: npm run db:testar
# ---------------------------------------------------------------------
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

echo "== Preparando o banco de teste (gas_teste) =="
$SUDO service mysql start >/dev/null 2>&1 || true
$SUDO mysql -e "DROP DATABASE IF EXISTS gas_teste; CREATE DATABASE gas_teste CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

# Roda o schema apontando para gas_teste (troca o nome so na execucao).
sed 's/^CREATE DATABASE IF NOT EXISTS gas$/CREATE DATABASE IF NOT EXISTS gas_teste/;
     s/^USE gas;$/USE gas_teste;/' "$RAIZ/db/schema_v2.sql" | $SUDO mysql

# O teste tambem comeca com "USE gas;" - sem trocar essa linha, os dados
# ficticios iriam para a base de producao. Por isso ela tambem e trocada.
saida="$(sed 's/^USE gas;$/USE gas_teste;/' "$RAIZ/db/teste_schema_v2.sql" | $SUDO mysql -t gas_teste)"
echo "$saida"

falhas=0
conferir() { # <rotulo> <valor_encontrado> <valor_esperado>
  if [ "$2" = "$3" ]; then
    printf '  [OK]    %s\n' "$1"
  else
    printf '  [FALHA] %s: encontrado "%s", esperado "%s"\n' "$1" "$2" "$3"
    falhas=$((falhas + 1))
  fi
}

consumo="$(echo "$saida" | awk '/^ *1 *\|/{print $0}' | head -1)"
echo
echo "== Conferencia automatica =="
c1="$($SUDO mysql -N -B gas_teste -e "SELECT GROUP_CONCAT(CONCAT(medidor_id,':',IFNULL(consumo_kg,'NULL')) ORDER BY medidor_id) FROM tb_consumo_diario WHERE data = CURDATE() - INTERVAL 1 DAY;")"
conferir "Teste 1 - consumo de ontem" "$c1" "1:2.50,2:1.70,3:0.00,4:1.50,5:NULL"

c2="$($SUDO mysql -N -B gas_teste -e "SELECT COUNT(*) FROM tb_alertas;")"
conferir "Teste 2 - total de alertas" "$c2" "2"

c3="$($SUDO mysql -N -B gas_teste -e "SELECT GROUP_CONCAT(CONCAT(medidor_id,':',tipo) ORDER BY medidor_id) FROM tb_alertas;")"
conferir "Teste 2 - tipos" "$c3" "1:VERMELHO,2:AMARELO"

c4="$($SUDO mysql -N -B gas_teste -e "SELECT GROUP_CONCAT(CONCAT(medidor_id,':',percentual_restante,':',status_nivel) ORDER BY medidor_id) FROM vw_nivel_atual;")"
conferir "Teste 4 - nivel atual" "$c4" "1:73:CHEIO,2:79:CHEIO,3:54:CHEIO,4:96:CHEIO,5:85:CHEIO"

c5="$($SUDO mysql -N -B gas_teste -e "SELECT GROUP_CONCAT(CONCAT(medidor_id,':',IFNULL(media_consumo_dia,'NULL')) ORDER BY medidor_id) FROM vw_previsao_troca;")"
conferir "Teste 5 - media 7 dias" "$c5" "1:1.21,2:1.10,3:0.00,4:1.07,5:NULL"

echo
echo "== Teste 6 - os 4 comandos abaixo tem que ser recusados =="
recusar() { # <rotulo> <sql>
  if $SUDO mysql gas_teste -e "$2" >/dev/null 2>&1; then
    printf '  [FALHA] %s: o banco aceitou (deveria recusar)\n' "$1"; falhas=$((falhas + 1))
  else
    printf '  [OK]    %s: recusado\n' "$1"
  fi
}
recusar "leitura duplicada"  "INSERT INTO tb_leituras (medidor_id, data_hora, peso_total_kg) VALUES (1, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '08:00:00'), 20);"
recusar "ESP32 repetido"     "INSERT INTO tb_medidores (local_id, identificador_esp32, capacidade_botijao_kg, peso_vazio_botijao_kg) VALUES (1,'ESP32-T1',13,13);"
recusar "peso negativo"      "INSERT INTO tb_leituras (medidor_id, peso_total_kg) VALUES (1,-5);"
recusar "medidor inexistente" "INSERT INTO tb_leituras (medidor_id, peso_total_kg) VALUES (999,10);"

$SUDO mysql -e "DROP DATABASE IF EXISTS gas_teste;"
echo
if [ "$falhas" -eq 0 ]; then
  echo "RESULTADO: todos os testes do guia passaram."
else
  echo "RESULTADO: $falhas teste(s) divergiram do esperado."
  exit 1
fi
