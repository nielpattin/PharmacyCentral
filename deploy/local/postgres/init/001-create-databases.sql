SELECT 'CREATE DATABASE catalog_service' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'catalog_service')\gexec
SELECT 'CREATE DATABASE inventory_service' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inventory_service')\gexec
SELECT 'CREATE DATABASE sales_service' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sales_service')\gexec
SELECT 'CREATE DATABASE payment_service' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'payment_service')\gexec
SELECT 'CREATE DATABASE operations_query_service' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'operations_query_service')\gexec

\connect catalog_service
CREATE EXTENSION IF NOT EXISTS postgis;
