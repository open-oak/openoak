import { PrismaClient } from "../generated/kanban/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postgresConnectionConfig } from "./postgres-connection";

const globalForKanban = global as unknown as {
  kanbanPrisma?: PrismaClient;
};

const connectionString =
  process.env.KANBAN_DATABASE_URL || process.env.DATABASE_URL || process.env.ACCOUNT_DATABASE_URL!;

export const kanbanPrisma =
  globalForKanban.kanbanPrisma ||
  new PrismaClient({
    adapter: new PrismaPg(
      {
        ...postgresConnectionConfig(connectionString),
      },
      { schema: process.env.KANBAN_DATABASE_SCHEMA || process.env.DATABASE_SCHEMA || "public" },
    ),
  });

if (process.env.NODE_ENV !== "production") globalForKanban.kanbanPrisma = kanbanPrisma;
