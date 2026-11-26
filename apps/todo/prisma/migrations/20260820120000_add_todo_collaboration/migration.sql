-- Expand only: legacy Task.isImportant/Task.isMyDay and the physical
-- Task.userId column remain available throughout the compatibility window.
CREATE TYPE "ListKind" AS ENUM ('DEFAULT', 'CUSTOM');

ALTER TABLE "TodoProfile"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "email" TEXT;

ALTER TABLE "List"
  ADD COLUMN "kind" "ListKind" NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "inviteEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inviteNonce" TEXT;

ALTER TABLE "List" ADD CONSTRAINT "List_only_custom_invitable"
  CHECK ("kind" = 'CUSTOM' OR ("inviteEnabled" = false AND "inviteNonce" IS NULL));

-- Every profile receives exactly one stable default list. Prefer the list the
-- legacy application treated as default, then retain its established ordering.
INSERT INTO "List" ("id", "name", "ownerId", "kind", "createdAt", "updatedAt", "sortOrder")
SELECT CONCAT('default_', MD5(profile."id")), 'Tasks', profile."id", 'DEFAULT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
FROM "TodoProfile" AS profile
WHERE NOT EXISTS (
  SELECT 1 FROM "List" AS existing WHERE existing."ownerId" = profile."id"
);

WITH ranked_lists AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "ownerId"
      ORDER BY CASE WHEN "name" = 'Tasks' THEN 0 ELSE 1 END, "sortOrder", "createdAt", "id"
    ) AS rank
  FROM "List"
)
UPDATE "List" AS list
SET "kind" = CASE WHEN ranked.rank = 1 THEN 'DEFAULT'::"ListKind" ELSE 'CUSTOM'::"ListKind" END
FROM ranked_lists AS ranked
WHERE list."id" = ranked."id";

CREATE UNIQUE INDEX "List_one_default_per_owner"
  ON "List" ("ownerId")
  WHERE "kind" = 'DEFAULT';
CREATE INDEX "List_ownerId_kind_idx" ON "List" ("ownerId", "kind");

CREATE TABLE "ListMember" (
  "id" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ListMember_listId_userId_key" ON "ListMember" ("listId", "userId");
CREATE INDEX "ListMember_userId_createdAt_idx" ON "ListMember" ("userId", "createdAt");
CREATE INDEX "ListMember_listId_createdAt_idx" ON "ListMember" ("listId", "createdAt");
ALTER TABLE "ListMember" ADD CONSTRAINT "ListMember_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListMember" ADD CONSTRAINT "ListMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "TodoProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "enforce_custom_list_membership"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "List" WHERE "id" = NEW."listId" AND "kind" = 'CUSTOM'
  ) THEN
    RAISE EXCEPTION 'Only custom Todo lists can have members';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ListMember_custom_list_only"
  BEFORE INSERT OR UPDATE OF "listId" ON "ListMember"
  FOR EACH ROW EXECUTE FUNCTION "enforce_custom_list_membership"();

CREATE TABLE "TaskPersonalState" (
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isImportant" BOOLEAN NOT NULL DEFAULT false,
  "isMyDay" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskPersonalState_pkey" PRIMARY KEY ("taskId", "userId")
);
CREATE INDEX "TaskPersonalState_userId_isMyDay_taskId_idx"
  ON "TaskPersonalState" ("userId", "isMyDay", "taskId");
CREATE INDEX "TaskPersonalState_userId_isImportant_taskId_idx"
  ON "TaskPersonalState" ("userId", "isImportant", "taskId");
ALTER TABLE "TaskPersonalState" ADD CONSTRAINT "TaskPersonalState_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPersonalState" ADD CONSTRAINT "TaskPersonalState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "TodoProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every creator's existing personal flags. The old columns remain so
-- older application versions can run and the migration can be rolled back.
INSERT INTO "TaskPersonalState" (
  "taskId", "userId", "isImportant", "isMyDay", "createdAt", "updatedAt"
)
SELECT "id", "userId", "isImportant", "isMyDay", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Task"
ON CONFLICT ("taskId", "userId") DO NOTHING;
