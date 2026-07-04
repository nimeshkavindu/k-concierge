import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.8.107", "192.168.*.*"],
};

export default nextConfig;
