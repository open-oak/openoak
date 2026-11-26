import { checkServerIdentity } from "node:tls";

export type PostgresSslMode = "disable" | "verify-full";

type PostgresEnvironment = Record<string, string | undefined> & {
  POSTGRES_SSL_CA?: string;
  POSTGRES_SSL_MODE?: string;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const RUNTIME_SSL_QUERY_PARAMETERS = [
  "ssl",
  "sslcert",
  "sslkey",
  "sslmode",
  "sslrootcert",
];

function parsePostgresUrl(connectionString: string) {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("PostgreSQL connection URLs must use postgres:// or postgresql://.");
  }
  return url;
}

function resolveSslMode(url: URL, env: PostgresEnvironment): PostgresSslMode {
  const configuredValue = env.POSTGRES_SSL_MODE?.trim().toLowerCase();
  if (configuredValue && configuredValue !== "disable" && configuredValue !== "verify-full") {
    throw new Error("POSTGRES_SSL_MODE must be either disable or verify-full.");
  }

  const urlMode = url.searchParams.get("sslmode")?.trim().toLowerCase();
  const configuredMode = configuredValue as PostgresSslMode | undefined;
  const legacyMode: PostgresSslMode | undefined = urlMode
    ? urlMode === "disable"
      ? "disable"
      : "verify-full"
    : undefined;
  const mode = configuredMode || legacyMode;
  const isLoopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  const resolvedMode = mode || (isLoopback ? "disable" : "verify-full");

  if (resolvedMode === "disable" && !isLoopback) {
    throw new Error("POSTGRES_SSL_MODE=disable is only allowed for loopback PostgreSQL hosts.");
  }

  return resolvedMode;
}

function normalizedCa(env: PostgresEnvironment) {
  const ca = env.POSTGRES_SSL_CA?.replace(/\\n/g, "\n").trim();
  return ca || undefined;
}

export function postgresConnectionConfig(
  connectionString: string,
  env: PostgresEnvironment = process.env,
) {
  const url = parsePostgresUrl(connectionString);
  const mode = resolveSslMode(url, env);
  for (const parameter of RUNTIME_SSL_QUERY_PARAMETERS) url.searchParams.delete(parameter);

  if (mode === "disable") {
    return { connectionString: url.toString(), ssl: false as const };
  }

  const ca = normalizedCa(env);
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true as const,
      checkServerIdentity,
      ...(ca ? { ca } : {}),
    },
  };
}

export function postgresMigrationUrl(
  connectionString: string | undefined,
  env: PostgresEnvironment = process.env,
) {
  if (!connectionString) return undefined;
  const url = parsePostgresUrl(connectionString);
  const mode = resolveSslMode(url, env);
  url.searchParams.delete("ssl");
  url.searchParams.set("sslmode", mode);
  return url.toString();
}
