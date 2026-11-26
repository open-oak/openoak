type AuthEnvironment = {
  BETTER_AUTH_SECRET?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
};

/** Development defaults must never become credentials on a production host. */
export function requireAuthSecret(env: AuthEnvironment, developmentDefault: string) {
  const secret = env.BETTER_AUTH_SECRET;
  const trimmed = secret?.trim();
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    if (!trimmed || trimmed.length < 32 || trimmed.toLowerCase().startsWith("replace-with") || trimmed === developmentDefault.trim()) {
      throw new Error("Refusing to start in production. Set BETTER_AUTH_SECRET to a generated secret of at least 32 characters.");
    }
  }
  return secret && trimmed ? secret : developmentDefault;
}
