import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postgresConnectionConfig } from "./postgres-connection";

const globalForPrisma = global as unknown as { accountPrisma?: PrismaClient };

const connectionString = process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL!;

export const prisma =
  globalForPrisma.accountPrisma ||
  new PrismaClient({
    adapter: new PrismaPg(
      {
        ...postgresConnectionConfig(connectionString),
      },
      { schema: process.env.DATABASE_SCHEMA || "public" },
    ),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.accountPrisma = prisma;
