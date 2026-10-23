#!/bin/sh
# Gives every service its own Postgres role that owns its own database and cannot connect to any other one. Runs as a
# one-shot Compose service, so it is safe to repeat: it creates missing roles, resets passwords, and moves the tables
# that an earlier run of the stack created as the admin user to the owning role.
set -eu

ensure_role() {
  psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d postgres -v name="$1" -v password="$2" -v admin="$POSTGRES_USER" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'name') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'name') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'name', :'password') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'name', :'name') \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'name') \gexec
\connect :name
SELECT format('ALTER SCHEMA %I OWNER TO %I', nspname, :'name') FROM pg_namespace WHERE nspname = 'drizzle' AND pg_get_userbyid(nspowner) = :'admin' \gexec
SELECT format(
  'ALTER %s %I.%I OWNER TO %I',
  CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
  n.nspname, c.relname, :'name')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p', 'S', 'v', 'm') AND pg_get_userbyid(c.relowner) = :'admin'
  AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a', 'i')) \gexec
SELECT format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, :'name')
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e' AND pg_get_userbyid(t.typowner) = :'admin'
  AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e') \gexec
SQL
}

ensure_role identity_service "$IDENTITY_DB_PASSWORD"
ensure_role catalog_service "$CATALOG_DB_PASSWORD"
ensure_role inventory_service "$INVENTORY_DB_PASSWORD"
ensure_role sales_service "$SALES_DB_PASSWORD"
ensure_role payment_service "$PAYMENT_DB_PASSWORD"
ensure_role operations_query_service "$OPERATIONS_QUERY_DB_PASSWORD"
ensure_role chatbot_service "$CHATBOT_DB_PASSWORD"
echo "database roles are in place"
