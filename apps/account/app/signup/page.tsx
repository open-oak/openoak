import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-server";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/apps");
  }

  return <SignupForm />;
}
