#!/usr/bin/env bash
set -euo pipefail

app=${1:-todo}
port=${2:-3000}
case "$app" in
  todo|kanban|outline) ;;
  *) printf 'Choose todo, kanban, or outline.\n' >&2; exit 2 ;;
esac
if [[ ! $port =~ ^[1-9][0-9]{0,4}$ ]] || ((port > 65535)); then
  printf 'Choose an HTTP port from 1 to 65535.\n' >&2
  exit 2
fi
if [[ ! -f package-lock.json || ! -f "apps/$app/.env.example" ]]; then
  printf 'Run this script from the OpenOak repository root.\n' >&2
  exit 2
fi

origin="http://localhost:$port"
env_file="apps/$app/.env"
if [[ -f "$env_file" ]]; then
  printf 'Using %s. Check the database URL and set BETTER_AUTH_URL to %s.\n' "$env_file" "$origin"
else
  : "${OPENOAK_DATABASE_URL:?Set a direct PostgreSQL URL for a dedicated database}"
  secret=$(openssl rand -base64 32)
  (
    umask 077
    set -o noclobber
    cat > "$env_file" <<DOTENV
DATABASE_URL="$OPENOAK_DATABASE_URL"
DIRECT_URL="$OPENOAK_DATABASE_URL"
DATABASE_SCHEMA="public"
BETTER_AUTH_SECRET="$secret"
BETTER_AUTH_URL="$origin"
DOTENV
  )
fi

npm ci
npm run migrate:deploy --workspace="@openoak/$app"
npm run build --workspace="@openoak/$app"
printf '\nOpen %s/login and select Sign up.\n' "$origin"
exec npm run start --workspace="@openoak/$app" -- --port "$port" --hostname 127.0.0.1
