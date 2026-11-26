export function quotePostgresIdentifier(identifier: string) {
  if (!identifier) throw new Error("PostgreSQL identifiers must not be empty");
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function qualifiedTableName(schema: string, table: string) {
  return `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)}`;
}
