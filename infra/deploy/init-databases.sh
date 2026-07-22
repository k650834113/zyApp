#!/bin/sh
set -eu

test_database="${TEST_POSTGRES_DB:-zyapp_test}"
case "$test_database" in
  ''|*[!a-zA-Z0-9_]*)
    echo 'TEST_POSTGRES_DB must contain only letters, digits, and underscores' >&2
    exit 1
    ;;
esac
escaped_database=$(printf '%s' "$test_database" | sed 's/"/""/g')

exists=$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only \
  --command "SELECT 1 FROM pg_database WHERE datname = '$test_database'" | tr -d '[:space:]')

if [ "$exists" != "1" ]; then
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --command "CREATE DATABASE \"$escaped_database\""
fi
