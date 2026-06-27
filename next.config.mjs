/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Allow production builds to complete even if the project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Allow production builds to complete even if the project has Type errors.
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ["langchain", "@langchain/core", "@langchain/google-genai", "langsmith", "@langchain/qdrant", "@qdrant/js-client-rest"],
  }
};

export default nextConfig;
