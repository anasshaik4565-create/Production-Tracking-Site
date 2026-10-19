-- =====================================================================
-- RESET A PASSWORD (Reader and Admin are independent).
-- Run in the Supabase SQL Editor. Run ONLY the block you need.
--
-- The new password is turned into a bcrypt hash by the database. The
-- password text exists only in the editor while you run it; it is not
-- stored anywhere. After running, clear the editor and close the tab.
-- Everyone using that account is signed out.
-- =====================================================================

-- ---- READER: change the text between the quotes, then run this block ----
UPDATE auth.users
   SET encrypted_password = extensions.crypt('TYPE-NEW-READER-PASSWORD-HERE', extensions.gen_salt('bf', 12)),
       updated_at = now()
 WHERE lower(email) = 'tracker-reader@example.com';
DELETE FROM auth.sessions
 WHERE user_id IN (SELECT id FROM auth.users WHERE lower(email) = 'tracker-reader@example.com');

-- ---- ADMIN: change the text between the quotes, then run this block ----
UPDATE auth.users
   SET encrypted_password = extensions.crypt('TYPE-NEW-ADMIN-PASSWORD-HERE', extensions.gen_salt('bf', 12)),
       updated_at = now()
 WHERE lower(email) = 'tracker-admin@example.com';
DELETE FROM auth.sessions
 WHERE user_id IN (SELECT id FROM auth.users WHERE lower(email) = 'tracker-admin@example.com');
