/** @type {import('next').NextConfig} */
const nextConfig = {
  // @csq/ui ships raw TypeScript through the workspace junction; compile it.
  transpilePackages: ["@csq/ui"],
};

export default nextConfig;
