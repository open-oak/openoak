import "dotenv/config";
import { defineConfig } from "prisma/config";
import { postgresMigrationUrl } from "./lib/postgres-connection";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: postgresMigrationUrl(process.env.DIRECT_URL || process.env.DATABASE_URL),
  },
});
