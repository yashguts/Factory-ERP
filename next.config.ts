import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // GAD drawings and program sketches are uploaded via server actions.
      // Next.js defaults the action request body to 1MB, which rejects real
      // drawings (PDFs/scans). Match the 50MB storage-bucket cap.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
