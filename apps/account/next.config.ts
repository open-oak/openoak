import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { pwaHeaders } from "../../shared/pwa/headers";

const nextConfig: NextConfig = {
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
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default withBotId(nextConfig);
