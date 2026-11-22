#!/usr/bin/env bash
# Starts or removes the disposable TLS PostgreSQL that integration tests and e2e use.
# CI and local runs both call this script, so the two cannot drift.
#
#   scripts/test-database.sh up    replace the container, enable TLS, create the runtime role
#   scripts/test-database.sh down  remove the container and the saved settings
#
# `up` writes .test-database/env. The test runners read it when TEST_DATABASE_URL is unset.
# TEST_DATABASE_CONTAINER and TEST_DATABASE_PORT pick another container name or host port.
set -euo pipefail

container="${TEST_DATABASE_CONTAINER:-between-moves-test-db}"
port="${TEST_DATABASE_PORT:-55432}"
image='postgres:16.10-bookworm'
database='between_moves_test'
admin_password='postgres-test-only'
runtime_role='between_moves_app'
runtime_password='runtime-test-only'
settings_dir="$(cd "$(dirname "$0")/.." && pwd)/.test-database"

case "${1:-}" in
  up) ;;
  down)
    docker rm -f "$container" >/dev/null 2>&1 || true
    rm -rf "$settings_dir"
    exit 0
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac

wait_until_ready() {
  for _ in $(seq 60); do
    if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d "$database" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL in $container did not become ready" >&2
  docker logs "$container" >&2
  return 1
}

psql_admin() {
  docker exec "$container" psql -h 127.0.0.1 -U postgres -d "$database" -v ON_ERROR_STOP=1 -q "$@"
}

docker rm -f "$container" >/dev/null 2>&1 || true
rm -rf "$settings_dir"
mkdir -p "$settings_dir"
key_dir="$(mktemp -d)"
trap 'rm -rf "$key_dir"' EXIT

openssl req -new -x509 -nodes -days 2 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout "$key_dir/server.key" -out "$settings_dir/server.crt" 2>/dev/null

docker run -d --name "$container" -p "127.0.0.1:$port:5432" \
  -e POSTGRES_DB="$database" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$admin_password" \
  "$image" >/dev/null
# The image's init script runs a temporary server on the socket only, so a TCP check waits for the real one.
wait_until_ready

docker cp "$key_dir/server.key" "$container:/var/lib/postgresql/data/server.key"
docker cp "$settings_dir/server.crt" "$container:/var/lib/postgresql/data/server.crt"
docker exec --user root "$container" sh -c \
  'chown postgres:postgres /var/lib/postgresql/data/server.* && chmod 600 /var/lib/postgresql/data/server.key'
psql_admin \
  -c "alter system set ssl = 'on'" \
  -c "alter system set ssl_cert_file = 'server.crt'" \
  -c "alter system set ssl_key_file = 'server.key'"
docker restart "$container" >/dev/null
wait_until_ready

# The web app connects as this role in e2e, as it does in production.
psql_admin -c "
  create role $runtime_role login password '$runtime_password';
  revoke create on schema public from public;
  grant connect on database $database to $runtime_role;
  grant usage on schema public to $runtime_role;
  alter default privileges for role postgres in schema public
    grant select, insert, update, delete on tables to $runtime_role;"

query="sslmode=require&sslrootcert=$settings_dir/server.crt"
cat >"$settings_dir/env" <<EOF
TEST_DATABASE_URL=postgresql://postgres:$admin_password@127.0.0.1:$port/$database?$query
TEST_RUNTIME_DATABASE_URL=postgresql://$runtime_role:$runtime_password@127.0.0.1:$port/$database?$query
EOF

echo "TLS PostgreSQL is ready in container $container on 127.0.0.1:$port."
echo "Settings are in $settings_dir/env. Remove both with: TEST_DATABASE_CONTAINER=$container pnpm db:test:down"
