import { describe, expect, it } from "vitest";
import { qualifiedTableName, quotePostgresIdentifier } from "@/lib/postgres-identifiers";

describe("PostgreSQL identifiers", () => {
  it("qualifies a case-sensitive table in the configured schema", () => {
    expect(qualifiedTableName("todo", "Task")).toBe('"todo"."Task"');
    expect(qualifiedTableName("public", "Task")).toBe('"public"."Task"');
  });

  it("escapes embedded identifier quotes", () => {
    expect(quotePostgresIdentifier('todo"; DROP SCHEMA auth; --')).toBe(
      '"todo""; DROP SCHEMA auth; --"',
    );
  });

  it("rejects empty identifiers", () => {
    expect(() => quotePostgresIdentifier("")).toThrow("must not be empty");
  });
});
