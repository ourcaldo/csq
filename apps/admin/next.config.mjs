/** @type {import('next').NextConfig} */
const nextConfig = {
  // @csq/core and @csq/ui ship raw TypeScript through workspace junctions.
  transpilePackages: ["@csq/core", "@csq/ui"],
};

export default nextConfig;
