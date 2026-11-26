-- Split auth ownership out to the central account database.
--
-- PREREQUISITE: the User/Account/Verification rows must already be copied into
-- the central account DB before running this (see MIGRATION.md). This migration
-- destroys the password hashes and auth columns in the Todo DB.
--
-- Task.userId and List.ownerId keep pointing at the same ids: renaming the
-- table updates the existing foreign keys automatically, so no data moves.

ALTER TABLE "User" RENAME TO "TodoProfile";
ALTER INDEX "User_pkey" RENAME TO "TodoProfile_pkey";

ALTER TABLE "TodoProfile" DROP COLUMN "email";
ALTER TABLE "TodoProfile" DROP COLUMN "name";
ALTER TABLE "TodoProfile" DROP COLUMN "image";
ALTER TABLE "TodoProfile" DROP COLUMN "emailVerified";

DROP TABLE "Session";
DROP TABLE "Account";
DROP TABLE "Verification";
