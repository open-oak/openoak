import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postgresConnectionConfig, postgresSchemaName } from "./postgres-connection";

const globalForPrisma = global as unknown as { outlinePrisma?: PrismaClient };

const connectionString = process.env.OUTLINE_DATABASE_URL || process.env.DATABASE_URL!;

export const prisma =
  globalForPrisma.outlinePrisma ||
  new PrismaClient({
    adapter: new PrismaPg(
      {
        ...postgresConnectionConfig(connectionString),
      },
      { schema: postgresSchemaName() },
    ),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.outlinePrisma = prisma;
