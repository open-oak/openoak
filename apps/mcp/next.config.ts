import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@openoak/outline", "@openoak/kanban", "@openoak/todo"],
  serverExternalPackages: ["pg"],
  experimental: {
    // Keep production type-checking deterministic across local and CI process wrappers.
    useTypeScriptCli: false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
