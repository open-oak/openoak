import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postgresConnectionConfig } from "./postgres-connection";

const globalForPrisma = global as unknown as { todoPrisma?: PrismaClient };

const connectionString = process.env.TODO_DATABASE_URL || process.env.DATABASE_URL!;

export const prisma =
  globalForPrisma.todoPrisma ||
  new PrismaClient({
    adapter: new PrismaPg(
      {
        ...postgresConnectionConfig(connectionString),
      },
      { schema: process.env.TODO_DATABASE_SCHEMA || process.env.DATABASE_SCHEMA || "public" },
    ),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.todoPrisma = prisma;
