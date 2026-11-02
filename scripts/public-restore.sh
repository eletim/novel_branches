#!/usr/bin/env bash
# Restore only into a NEW project. Existing production volumes are never overwritten.
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir=$(realpath "${1:?Usage: public-restore.sh BACKUP_DIRECTORY NEW_PROJECT}")
restore_project="${2:?Supply a new, unused Compose project name}"
[[ "$restore_project" =~ ^novel-restore-[a-z0-9-]+$ ]] || { echo 'Project must start with novel-restore-'; exit 1; }
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$restore_project")" ]] || { echo 'Project already exists'; exit 1; }
[[ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$restore_project")" ]] || { echo 'Project volumes already exist'; exit 1; }
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
dc=(docker compose -p "$restore_project" --env-file "$backup_dir/deployment.env" -f deploy/compose.public.yaml)
"${dc[@]}" up -d --wait keycloak-db
"${dc[@]}" exec -T keycloak-db pg_restore -U keycloak -d keycloak --no-owner --no-privileges --exit-on-error < "$backup_dir/keycloak.dump"
"${dc[@]}" run --rm --no-deps -T --user 1000:1000 --entrypoint tar app xzf - -C /app/data < "$backup_dir/sqlite.tgz"
"${dc[@]}" run --rm --no-deps -T --entrypoint node app --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/app/data/novels.db",{readOnly:true});
if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("SQLite integrity failed");
console.log("SQLite integrity: OK");
console.log(JSON.stringify(db.prepare("SELECT count(*) AS stories FROM stories").get()));'
"${dc[@]}" exec -T keycloak-db psql -U keycloak -d keycloak -Atc 'SELECT count(*) FROM user_entity;'
"${dc[@]}" stop keycloak-db
printf 'Restored both DBs into %s; services are stopped.\n' "$restore_project"
