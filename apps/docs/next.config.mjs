/** @type {import('next').NextConfig} */
const nextConfig = {
  // @csq/core ships raw TypeScript through the workspace junction; compile it.
  transpilePackages: ["@csq/core"],
};

export default nextConfig;
