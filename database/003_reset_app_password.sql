-- Run ONLY in Neon SQL Editor as the authorized test database owner.
-- Replace BOTH placeholders locally; never commit or share the filled-in SQL.
-- The SQL editor may retain query history. Keep access restricted.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $reset$
DECLARE
    target_user text := 'example_username';
    new_password text := $pw$REPLACE_WITH_PRIVATE_PASSWORD$pw$;
BEGIN
    IF target_user = 'example_username' OR new_password = 'REPLACE_WITH_PRIVATE_PASSWORD' THEN
        RAISE EXCEPTION 'Replace both placeholders before running';
    END IF;
    IF octet_length(new_password) NOT BETWEEN 12 AND 72 THEN
        RAISE EXCEPTION 'Password must be 12 to 72 UTF-8 bytes';
    END IF;
    UPDATE app_users
    SET password_hash = crypt(new_password, gen_salt('bf', 12)),
        active = true
    WHERE username = lower(trim(target_user));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application user not found';
    END IF;
    DELETE FROM login_attempts WHERE username = lower(trim(target_user));
    DELETE FROM app_sessions WHERE username = lower(trim(target_user));
END;
$reset$;
COMMIT;
-- This preserves existing access grants and invalidates old sessions.
