-- Remove Moodle and VUT (Brno University of Technology) integrations.

-- DropForeignKey
ALTER TABLE "MoodleSync" DROP CONSTRAINT "MoodleSync_userId_fkey";

-- DropForeignKey
ALTER TABLE "VutCredentials" DROP CONSTRAINT "VutCredentials_userId_fkey";

-- DropIndex
DROP INDEX "VFile_userId_source_sourceRef_idx";

-- AlterTable
ALTER TABLE "VFile" DROP COLUMN "externalUrl",
DROP COLUMN "source",
DROP COLUMN "sourceRef";

-- DropTable
DROP TABLE "MoodleSync";

-- DropTable
DROP TABLE "VutCredentials";

-- Clean up any calendar events sourced from VUT/Moodle.
DELETE FROM "CalendarEvent" WHERE "source" IN ('vut', 'moodle');

-- Clean up any study sources of kind 'moodle'.
DELETE FROM "StudySource" WHERE "kind" = 'moodle';
