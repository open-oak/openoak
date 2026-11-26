import { PrismaClient } from "@/generated/central/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postgresConnectionConfig } from "@/lib/postgres-connection";

// Client for the central account DB. Used only to validate the shared session.
const globalForCentral = global as unknown as { centralPrisma: PrismaClient };

export const centralPrisma =
  globalForCentral.centralPrisma ||
  new PrismaClient({
    adapter: new PrismaPg(
      {
        ...postgresConnectionConfig(
          process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL!,
        ),
      },
      {
        schema:
          process.env.ACCOUNT_DATABASE_SCHEMA || process.env.DATABASE_SCHEMA || "public",
      },
    ),
  });

if (process.env.NODE_ENV !== "production") globalForCentral.centralPrisma = centralPrisma;
