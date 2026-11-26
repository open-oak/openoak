import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "prisma/migrations/20260820120000_add_todo_collaboration/migration.sql"),
  "utf8",
);
const inviteIndexMigration = readFileSync(
  resolve(root, "prisma/migrations/20260820210000_index_todo_invite_nonce/migration.sql"),
  "utf8",
);
const scopedTriggerMigration = readFileSync(
  resolve(root, "prisma/migrations/20260820220000_scope_todo_membership_trigger/migration.sql"),
  "utf8",
);

describe("Todo collaboration migration", () => {
  it("maps creator identity without renaming stored task data", () => {
    expect(schema).toMatch(/createdById\s+String\s+@map\("userId"\)/);
    expect(schema).toContain('@map("userId")');
    expect(migration).not.toContain('RENAME COLUMN "userId"');
  });

  it("backfills one default list and creator personal flags", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "List_one_default_per_owner"');
    expect(migration).toContain('WHERE "kind" = \'DEFAULT\'');
    expect(migration).toContain('INSERT INTO "TaskPersonalState"');
    expect(migration).toContain('SELECT "id", "userId", "isImportant", "isMyDay"');
    expect(migration).toContain('CREATE TRIGGER "ListMember_custom_list_only"');
    expect(migration).toContain('"kind" = \'CUSTOM\'');
  });

  it("retains legacy personal flag columns for rollback", () => {
    expect(schema).toContain("isImportant Boolean");
    expect(schema).toContain("isMyDay     Boolean");
    expect(migration).not.toContain('DROP COLUMN "isImportant"');
    expect(migration).not.toContain('DROP COLUMN "isMyDay"');
  });

  it("indexes the opaque invite nonce as a unique lookup key", () => {
    expect(schema).toMatch(/inviteNonce\s+String\?\s+@unique/);
    expect(inviteIndexMigration).toContain('CREATE UNIQUE INDEX "List_inviteNonce_key"');
  });

  it("resolves the membership trigger against the deployed Todo schema", () => {
    expect(scopedTriggerMigration).toContain("TG_TABLE_SCHEMA");
    expect(scopedTriggerMigration).toContain('FROM %I."List"');
    expect(scopedTriggerMigration).toContain("USING NEW.\"listId\"");
  });
});
