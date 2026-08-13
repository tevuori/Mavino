-- Helper function to set RLS context variables within a transaction.
-- Uses set_config(..., true) which is equivalent to SET LOCAL.
-- This allows parameterized calls from Prisma ($executeRaw) which SET LOCAL does not support.
CREATE OR REPLACE FUNCTION set_rls_context(p_user_id text, p_is_admin boolean)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_user_id', COALESCE(p_user_id, ''), true);
  PERFORM set_config('app.is_admin', CASE WHEN p_is_admin THEN 'true' ELSE 'false' END, true);
END;
$$ LANGUAGE plpgsql;

-- Enable PostgreSQL Row-Level Security (RLS) on all user-scoped tables.
-- This is defense-in-depth: the application already scopes all queries by
-- userId from the auth context. RLS adds a DB-level check so that even if a
-- bug forgets the WHERE clause, a user can never see another user's rows.
--
-- The application sets `app.current_user_id` and `app.is_admin` via
-- SET LOCAL inside a Prisma interactive transaction (see server/src/db/rls.ts).
-- When the variables are not set (auth flows, migrations, system queries),
-- the policies allow all access — RLS only restricts authenticated requests.

-- Tables with a direct non-nullable "userId" column.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'userId'
      AND table_schema = 'public'
      AND is_nullable = 'NO'
      AND table_name NOT IN ('User', 'RefreshToken', 'PasswordResetToken')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS user_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY user_isolation ON %I
         USING ( %I = COALESCE(current_setting(''app.current_user_id'', true), '''')
                 OR COALESCE(current_setting(''app.is_admin'', true), '''') = ''true''
                 OR COALESCE(current_setting(''app.current_user_id'', true), '''') = '''' )',
      t, 'userId');
    EXECUTE format('DROP POLICY IF EXISTS user_isolation_write ON %I', t);
    EXECUTE format(
      'CREATE POLICY user_isolation_write ON %I
         WITH CHECK ( %I = COALESCE(current_setting(''app.current_user_id'', true), '''')
                      OR COALESCE(current_setting(''app.is_admin'', true), '''') = ''true''
                      OR COALESCE(current_setting(''app.current_user_id'', true), '''') = '''' )',
      t, 'userId');
  END LOOP;
END $$;

-- Tables with a nullable "userId" column (ErrorLog, LyricsCache, Setting).
-- These allow rows where userId IS NULL (system/global rows).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'userId'
      AND table_schema = 'public'
      AND is_nullable = 'YES'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS user_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY user_isolation ON %I
         USING ( %I IS NULL
                 OR %I = COALESCE(current_setting(''app.current_user_id'', true), '''')
                 OR COALESCE(current_setting(''app.is_admin'', true), '''') = ''true''
                 OR COALESCE(current_setting(''app.current_user_id'', true), '''') = '''' )',
      t, 'userId', 'userId');
    EXECUTE format('DROP POLICY IF EXISTS user_isolation_write ON %I', t);
    EXECUTE format(
      'CREATE POLICY user_isolation_write ON %I
         WITH CHECK ( %I IS NULL
                      OR %I = COALESCE(current_setting(''app.current_user_id'', true), '''')
                      OR COALESCE(current_setting(''app.is_admin'', true), '''') = ''true''
                      OR COALESCE(current_setting(''app.current_user_id'', true), '''') = '''' )',
      t, 'userId', 'userId');
  END LOOP;
END $$;

-- Linked tables (no direct userId, but parent has one).
-- Flashcard → FlashcardDeck.userId
ALTER TABLE "Flashcard" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON "Flashcard";
CREATE POLICY user_isolation ON "Flashcard"
  USING ( EXISTS (
    SELECT 1 FROM "FlashcardDeck" d
    WHERE d.id = "Flashcard"."deckId"
      AND ( d."userId" = COALESCE(current_setting('app.current_user_id', true), '')
            OR COALESCE(current_setting('app.is_admin', true), '') = 'true'
            OR COALESCE(current_setting('app.current_user_id', true), '') = '' )
  ));
DROP POLICY IF EXISTS user_isolation_write ON "Flashcard";
CREATE POLICY user_isolation_write ON "Flashcard"
  WITH CHECK ( EXISTS (
    SELECT 1 FROM "FlashcardDeck" d
    WHERE d.id = "Flashcard"."deckId"
      AND ( d."userId" = COALESCE(current_setting('app.current_user_id', true), '')
            OR COALESCE(current_setting('app.is_admin', true), '') = 'true'
            OR COALESCE(current_setting('app.current_user_id', true), '') = '' )
  ));

-- Assignment → Course.userId
ALTER TABLE "Assignment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON "Assignment";
CREATE POLICY user_isolation ON "Assignment"
  USING ( EXISTS (
    SELECT 1 FROM "Course" c
    WHERE c.id = "Assignment"."courseId"
      AND ( c."userId" = COALESCE(current_setting('app.current_user_id', true), '')
            OR COALESCE(current_setting('app.is_admin', true), '') = 'true'
            OR COALESCE(current_setting('app.current_user_id', true), '') = '' )
  ));
DROP POLICY IF EXISTS user_isolation_write ON "Assignment";
CREATE POLICY user_isolation_write ON "Assignment"
  WITH CHECK ( EXISTS (
    SELECT 1 FROM "Course" c
    WHERE c.id = "Assignment"."courseId"
      AND ( c."userId" = COALESCE(current_setting('app.current_user_id', true), '')
            OR COALESCE(current_setting('app.is_admin', true), '') = 'true'
            OR COALESCE(current_setting('app.current_user_id', true), '') = '' )
  ));

-- CompassReview → CompassProject.userId
ALTER TABLE "CompassReview" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON "CompassReview";
CREATE POLICY user_isolation ON "CompassReview"
  USING ( EXISTS (
    SELECT 1 FROM "CompassProject" p
    WHERE p.id = "CompassReview"."projectId"
      AND ( p."userId" = COALESCE(current_setting('app.current_user_id', true), '')
            OR COALESCE(current_setting('app.is_admin', true), '') = 'true'
            OR COALESCE(current_setting('app.current_user_id', true), '') = '' )
  ));
DROP POLICY IF EXISTS user_isolation_write ON "CompassReview";
CREATE POLICY user_isolation_write ON "CompassReview"
  WITH CHECK ( EXISTS (
    SELECT 1 FROM "CompassProject" p
    WHERE p.id = "CompassReview"."projectId"
      AND ( p."userId" = COALESCE(current_setting('app.current_user_id', true), '')
            OR COALESCE(current_setting('app.is_admin', true), '') = 'true'
            OR COALESCE(current_setting('app.current_user_id', true), '') = '' )
  ));
