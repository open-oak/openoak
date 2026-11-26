export function completionPath(redirectTo: string | null | undefined) {
  const params = new URLSearchParams();
  if (redirectTo) params.set("redirect", redirectTo);
  const query = params.toString();
  return query ? `/auth/complete?${query}` : "/auth/complete";
}
