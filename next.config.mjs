/** @type {import('next').NextConfig} */
const nextConfig = {
    eslint: {
      // This completely disables ESLint during builds
      ignoreDuringBuilds: true,
    },
  };
  
  // Use ES module export syntax instead of CommonJS
  export default nextConfig;