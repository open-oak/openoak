export type SuiteSchemas = { account: string; todo: string; outline: string; kanban: string };
export type DeletionDatabase = {
  query<T>(sql: string, ...values: unknown[]): Promise<T[]>;
  execute(sql: string, ...values: unknown[]): Promise<number>;
};

export function deletionSchemas(value: string | undefined): SuiteSchemas | null {
  if (!value?.trim()) return null;
  const config = JSON.parse(value) as SuiteSchemas;
  const values = [config.account, config.todo, config.outline, config.kanban];
  if (values.some((schema) => typeof schema !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) || new Set(values).size !== 4) {
    throw new Error("ACCOUNT_DELETION_SCHEMAS must name four distinct PostgreSQL schemas.");
  }
  return config;
}

const links = [
  ["todo", "TodoProfile", "id"], ["outline", "NotesProfile", "id"],
  ["kanban", "KanbanDocument", "userId"], ["kanban", "KanbanBoardIdentity", "ownerId"],
  ["kanban", "KanbanProfile", "userId"], ["kanban", "KanbanTransition", "ownerId"],
  ["kanban", "KanbanRollbackSnapshot", "ownerId"], ["kanban", "KanbanOperationReceipt", "actorId"],
  ["kanban", "KanbanOperationReceipt", "ownerId"], ["kanban", "KanbanBoardMember", "userId"],
] as const;

// Shared-suite installation step only. Standalone apps keep their local auth
// schema. These keys prevent an in-flight request from recreating deleted data.
export async function installSuiteAccountLinks(db: DeletionDatabase, schemas: SuiteSchemas) {
  deletionSchemas(JSON.stringify(schemas));
  for (const [app, table, column] of links) {
    const name = `suite_${table}_${column}_account`;
    const existing = await db.query<{ valid: boolean }>(`SELECT convalidated AS valid FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass`, name, `"${schemas[app]}"."${table}"`);
    if (!existing.length) await db.execute(`ALTER TABLE "${schemas[app]}"."${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${schemas.account}"."User"("id") ON DELETE CASCADE NOT VALID`);
    await db.execute(`ALTER TABLE "${schemas[app]}"."${table}" VALIDATE CONSTRAINT "${name}"`);
  }
  await assertSuiteAccountLinks(db, schemas);
}

export async function assertSuiteAccountLinks(db: DeletionDatabase, schemas: SuiteSchemas) {
  deletionSchemas(JSON.stringify(schemas));
  for (const [app, table, column] of links) {
    const rows = await db.query<{ valid: boolean }>(`SELECT c.convalidated AS valid FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.conname=$1 AND c.conrelid=$2::regclass AND c.confrelid=$3::regclass AND c.contype='f' AND c.confdeltype='c' AND a.attname=$4`,
    `suite_${table}_${column}_account`, `"${schemas[app]}"."${table}"`, `"${schemas.account}"."User"`, column);
    if (!rows[0]?.valid) throw new Error("Shared-suite account links are not installed and validated.");
  }
}

// Caller must run this whole function in one READ COMMITTED transaction.
// The legacy Kanban fence rejects other isolation levels. Do not disable it.
export async function deleteSuiteAccountData(db: DeletionDatabase, schemas: SuiteSchemas, userId: string, verify?: () => Promise<void>) {
  await assertSuiteAccountLinks(db, schemas);
  const a = `"${schemas.account}"`, t = `"${schemas.todo}"`, o = `"${schemas.outline}"`, k = `"${schemas.kanban}"`;
  // Kanban recovery triggers use their owning schema as the search path.
  // Account normally uses another schema on this same connection.
  await db.query("SELECT set_config('search_path', $1, true)", `${k}, pg_catalog`);
  await db.execute("SELECT pg_advisory_xact_lock(hashtextextended('openkanban:' || $1 || ':' || $2, 0))", schemas.kanban, userId);
  const users = await db.query<{ id: string; email: string }>(`SELECT id,email FROM ${a}."User" WHERE id=$1 FOR UPDATE`, userId);
  if (!users.length) return { deleted: false };
  await verify?.();
  // Lock the identity row before deleting product roots. FK key-share locks
  // make new writes wait, then reject them after the account is gone.
  const identities = await db.query<{ boardKey: string }>(`SELECT "boardKey" FROM ${k}."KanbanBoardIdentity" WHERE "ownerId"=$1`, userId);
  const keys = identities.map((row) => row.boardKey);
  await db.execute(`UPDATE ${k}."KanbanProfile" SET "selectedBoardKey"=NULL, version=version+1 WHERE "selectedBoardKey"=ANY($1::text[]) AND "userId"<>$2`, keys, userId);
  await db.execute(`DELETE FROM ${k}."KanbanProfile" WHERE "userId"=$1`, userId);
  await db.execute(`DELETE FROM ${k}."KanbanOperationReceipt" WHERE "actorId"=$1 OR "ownerId"=$1 OR "boardKey"=ANY($2::text[])`, userId, keys);
  await db.execute(`DELETE FROM ${k}."KanbanBoardMember" WHERE "userId"=$1`, userId);
  for (const table of ["KanbanCard", "KanbanChange", "KanbanEntityIdentity"]) await db.execute(`DELETE FROM ${k}."${table}" WHERE "boardKey"=ANY($1::text[])`, keys);
  await db.execute(`DELETE FROM ${k}."KanbanBoard" WHERE "ownerId"=$1`, userId);
  await db.execute(`DELETE FROM ${k}."KanbanBoardIdentity" WHERE "ownerId"=$1`, userId);
  await db.execute(`DELETE FROM ${k}."KanbanRollbackSnapshot" WHERE "ownerId"=$1`, userId);
  // Removing this owner's transition under the same fence permits the final
  // legacy delete. Other owners' transition state remains unchanged.
  await db.execute(`DELETE FROM ${k}."KanbanTransition" WHERE "ownerId"=$1`, userId);
  await db.execute(`DELETE FROM ${k}."KanbanDocument" WHERE "userId"=$1`, userId);
  await db.execute(`DELETE FROM ${t}."TodoProfile" WHERE id=$1`, userId);
  await db.execute(`UPDATE ${t}."TaskTrash" SET snapshot=jsonb_set(snapshot,'{personalStates}',
    COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(snapshot->'personalStates') s WHERE s->>'userId'<>$1),'[]'::jsonb))
    WHERE snapshot->'personalStates' @> jsonb_build_array(jsonb_build_object('userId',$1::text))`, userId);
  await db.execute(`DELETE FROM ${o}."NotesProfile" WHERE id=$1`, userId);
  await db.execute(`DELETE FROM ${a}."Verification" WHERE value=$1 OR identifier=$2 OR identifier=$3
    OR CASE WHEN pg_input_is_valid(value,'jsonb') THEN value::jsonb->>'userId' END=$1`, userId, users[0].email, `delete-attempt:${userId}`);
  await db.execute(`DELETE FROM ${a}."User" WHERE id=$1`, userId);
  return { deleted: true };
}
