-- =====================================================================
-- ACCESS SETUP: give the two login accounts their roles.
-- Run this ONCE in the Supabase SQL Editor, AFTER creating the two users
-- in Authentication -> Users (see the instructions).
--
-- The role is stored in app_metadata, which the browser can never change.
-- Safe to run again.
-- =====================================================================
UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('app_role', 'reader')
 WHERE lower(email) = 'tracker-reader@example.com';

UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('app_role', 'admin')
 WHERE lower(email) = 'tracker-admin@example.com';

-- Names shown in the history log.
UPDATE public.profiles SET full_name = 'Reader' WHERE lower(email) = 'tracker-reader@example.com';
UPDATE public.profiles SET full_name = 'Admin'  WHERE lower(email) = 'tracker-admin@example.com';

-- Check: you should see two rows, one reader and one admin.
SELECT email, raw_app_meta_data ->> 'app_role' AS app_role
  FROM auth.users
 WHERE lower(email) IN ('tracker-reader@example.com', 'tracker-admin@example.com')
 ORDER BY email;
