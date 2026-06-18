import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (bundles pdfjs) runs in the server action that reads uploaded Part
  // Lists. Keep it un-bundled so pdfjs's runtime isn't broken by the bundler.
  serverExternalPackages: ["pdf-parse"],
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
