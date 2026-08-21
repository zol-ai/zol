import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    Emits a self-contained server bundle with only the node_modules actually
    reached at runtime. This is what makes the Cloud Run image small; Vercel
    ignores it and uses its own build output, so both targets work from this
    one repo.
  */
  output: "standalone",

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
