import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The browser only ever talks to this origin; Next forwards API calls to
  // the Express server, so there's no CORS to configure for the demo.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/user/:path*", destination: `${apiUrl}/user/:path*` },
    ];
  },
};

export default nextConfig;
