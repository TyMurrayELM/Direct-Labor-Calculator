/** @type {import('next').NextConfig} */
const nextConfig = {
    eslint: {
      // This completely disables ESLint during builds
      ignoreDuringBuilds: true,
    },
    // Other Next.js config options you might have
  };
  
  module.exports = nextConfig;