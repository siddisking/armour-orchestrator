/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["langchain", "@langchain/core", "@langchain/google-genai", "langsmith"],
  },
};

export default nextConfig;
