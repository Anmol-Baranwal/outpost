-- Pathfinder stores its index/session state in a separate `pathfinder` database.
-- docker-compose points the pathfinder service at postgres://.../pathfinder.
-- This runs only on a fresh postgres volume (docker-entrypoint-initdb.d).
SELECT 'CREATE DATABASE pathfinder'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pathfinder')\gexec
