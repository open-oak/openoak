export const usesSharedAuth = Boolean(process.env.ACCOUNT_DATABASE_URL?.trim());
export const accountUrl = process.env.NEXT_PUBLIC_ACCOUNT_URL?.trim() || "https://account.openoak.org";
export const authCookiePrefix = usesSharedAuth ? process.env.AUTH_COOKIE_PREFIX?.trim() || "openoak" : process.env.AUTH_COOKIE_PREFIX?.trim() || "open-kanban";
export function loginUrl(baseUrl: string) { return new URL("/login", usesSharedAuth ? accountUrl : baseUrl); }
