import { spawnSync } from "node:child_process";

const environment = process.env.VERCEL_ENV || "local";
const previewDatabaseIsolated = process.env.PREVIEW_DATABASE_ISOLATED === "true";
const migrate = environment === "production" || (environment === "preview" && previewDatabaseIsolated);

function run(script) {
  const result = spawnSync("npm", ["run", script], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (migrate) {
  console.log(`Applying owned-schema migrations for the ${environment} deployment.`);
  run("migrate:deploy");
} else {
  console.log(
    environment === "preview"
      ? "Skipping migrations: Preview database isolation has not been confirmed."
      : "Skipping migrations outside Vercel Production.",
  );
}

run("build");
