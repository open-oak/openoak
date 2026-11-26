import "dotenv/config";
import { defineConfig } from "prisma/config";
import { postgresMigrationUrl } from "./lib/postgres-connection";

export default defineConfig({
  schema: "prisma/kanban.prisma",
  migrations: {
    path: "prisma/kanban-migrations",
  },
  datasource: {
    url: postgresMigrationUrl(
      process.env.KANBAN_DIRECT_URL ||
      process.env.DIRECT_URL ||
      process.env.KANBAN_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.ACCOUNT_DATABASE_URL,
    ),
  },
});
