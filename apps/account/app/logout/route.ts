import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-server";

// POST-only: a GET here would be prefetched by <Link>/crawlers and silently
// sign the user out. Logout must be an explicit form submission.
export async function POST() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
