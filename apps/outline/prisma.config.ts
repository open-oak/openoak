import "dotenv/config";
import { defineConfig } from "prisma/config";
import { postgresMigrationUrl } from "./lib/postgres-connection";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: postgresMigrationUrl(
      process.env.OUTLINE_DIRECT_URL ||
      process.env.DIRECT_URL ||
      process.env.OUTLINE_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/openoutline",
    ),
  },
});
