type AccountDatabase = {
  query(sql: string, values: string[]): Promise<{ rows: { revokedAt: Date | null }[] }>;
};

// JWT signatures remain valid after deletion. Require the account to still
// exist, even when cascading cleanup has removed its revocation records.
export async function accountTokenIsRevoked(
  database: AccountDatabase,
  schema: string,
  userId: string,
  clientId: string,
  issuedAt: number,
) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("Invalid ACCOUNT_DATABASE_SCHEMA.");
  const { rows } = await database.query(
    `SELECT r."revokedAt" FROM "${schema}"."User" u
     JOIN "${schema}"."oauthClient" c ON c."clientId"=$2 AND COALESCE(c.disabled,false)=false
     LEFT JOIN "${schema}"."OauthRevocation" r ON r."userId" = u.id AND r."clientId" = $2
     WHERE u.id = $1 LIMIT 1`,
    [userId, clientId],
  );
  if (rows.length === 0) return true;
  const revokedAt = rows[0].revokedAt;
  return Boolean(revokedAt && issuedAt * 1000 <= revokedAt.getTime());
}
