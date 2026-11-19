#!/usr/bin/env bash
# Faz backup do banco do Grafana (usuários, contact points, ajustes da tela).
# Uso: ./scripts/backup-grafana.sh <pasta-de-destino> [dias-para-manter]
set -euo pipefail

DEST=${1:?informe a pasta de destino}
KEEP_DAYS=${2:-14}
cd "$(dirname "$0")/.."

mkdir -p "$DEST"
FILE="$DEST/grafana-$(date +%Y%m%d-%H%M%S).tar.gz"
trap '[ $? -eq 0 ] || rm -f "$FILE"' EXIT

# A imagem do LGTM não tem tar: um container auxiliar lê o mesmo volume,
# sem parar o serviço.
LGTM_ID=$(docker compose ps -q lgtm)
[ -n "$LGTM_ID" ] || { echo "container lgtm não está rodando" >&2; exit 1; }
docker run --rm --volumes-from "$LGTM_ID" alpine:3.22 tar czf - -C /data grafana/data > "$FILE"

find "$DEST" -name 'grafana-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup salvo em $FILE"
