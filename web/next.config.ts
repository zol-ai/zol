import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    Emits a self-contained server bundle with only the node_modules actually
    reached at runtime, which is what keeps the Cloud Run image small.

    Vercel does NOT ignore this, contrary to what this comment used to claim.
    Its builder applies its own config transform and then fails looking for a
    file-trace manifest that Turbopack never writes:

      ENOENT: .next/next-server.js.nft.json

    Vercel builds its own output format and needs nothing from standalone, so
    switch it off there. VERCEL=1 is set in every Vercel build environment.
    A local `npm run build` still produces the standalone bundle, which is why
    this failure does not reproduce off-platform.
  */
  output: process.env.VERCEL ? undefined : "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
