#!/bin/sh
# One-shot logical backup. The scheduler passes the absolute path to the
# tracked Dev or Production Compose file; credentials remain in the adjacent
# operator-managed .env, never in the unit, timer or command arguments.
set -eu

compose_file="${1:?pass the absolute tracked Compose file path}"
case "$compose_file" in
  /*/docker-compose.dokploy.yml|/*/docker-compose.production.yml) ;;
  *) >&2 printf '%s\n' 'Expected an absolute tracked Dev or Production Compose file.'; exit 1 ;;
esac
if [ ! -f "$compose_file" ]; then
  >&2 printf '%s\n' 'The Compose file does not exist.'
  exit 1
fi
project_dir="$(dirname "$compose_file")"
if [ ! -f "$project_dir/.env" ]; then
  >&2 printf '%s\n' 'The adjacent operator-managed .env is missing.'
  exit 1
fi

compose() {
  docker compose --project-directory "$project_dir" --env-file "$project_dir/.env" -f "$compose_file" "$@"
}

compose --profile backup config --quiet
db_id="$(compose ps -q db)"
if [ -z "$db_id" ] || [ "$(docker inspect --format '{{.State.Health.Status}}' "$db_id")" != healthy ]; then
  >&2 printf '%s\n' 'Database is not healthy; refusing to start a backup or bring it up implicitly.'
  exit 1
fi
compose --profile backup run --rm --no-deps backup
