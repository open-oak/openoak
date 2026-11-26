import { NextRequest } from "next/server";
import { secureRequest } from "@/lib/secure-request";

export function proxy(request: NextRequest) {
  return secureRequest(request).next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
