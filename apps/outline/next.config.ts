import type { NextConfig } from "next";
import packageJson from "./package.json";
import { pwaHeaders } from "../../shared/pwa/headers";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_BUILD_REVISION: process.env.VERCEL_GIT_COMMIT_SHA || process.env.OPENOAK_GIT_SHA || "",
    NEXT_PUBLIC_LEGAL_URL:
      process.env.NEXT_PUBLIC_LEGAL_URL || "https://openoak.org/legal/",
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "notes.openoak.org" }],
        destination: "https://outline.openoak.org/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "app.openoutline.org" }],
        destination: "https://outline.openoak.org/:path*",
        permanent: true,
      },
    ];
  },
  experimental: {
    // Keep production type-checking deterministic across local and CI process wrappers.
    useTypeScriptCli: false,
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      ...pwaHeaders("/sw.js"),
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
        ]
      }
    ];
  }
};

export default nextConfig;
