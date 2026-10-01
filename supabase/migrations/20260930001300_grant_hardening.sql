-- Defense in depth: API roles never need TRUNCATE (which bypasses row-level security),
-- REFERENCES or TRIGGER on application tables. Revoke them now and for tables created later.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
