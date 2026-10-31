#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
dc=(docker compose --env-file deploy/.env -f deploy/compose.public.yaml)
backup_root="${1:-$HOME/novel-backups}"
mkdir -p "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$backup_dir"
# Stop every writer in both stores before taking either snapshot.
"${dc[@]}" stop nginx app keycloak
trap '"${dc[@]}" up -d >/dev/null' EXIT
"${dc[@]}" exec -T keycloak-db pg_dump -U keycloak -d keycloak -Fc > "$backup_dir/keycloak.dump"
# App is stopped; include SQLite WAL/SHM with the database in a single archive.
app_id=$("${dc[@]}" ps -aq app)
docker run --rm --network none --volumes-from "$app_id":ro --entrypoint tar novel-public-app -czf - -C /app/data . > "$backup_dir/sqlite.tgz"
cp deploy/.env "$backup_dir/deployment.env"
cp deploy/compose.public.yaml "$backup_dir/compose.public.yaml"
cp /home/ubuntu/notify-server/Caddyfile "$backup_dir/Caddyfile"
git rev-parse HEAD > "$backup_dir/commit.txt"
(cd "$backup_dir" && sha256sum keycloak.dump sqlite.tgz deployment.env compose.public.yaml Caddyfile commit.txt > SHA256SUMS)
printf '%s\n' "$backup_dir"
