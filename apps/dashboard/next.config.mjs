/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the production Docker image.
  output: "standalone",
  // @csq/core ships raw TypeScript through the workspace junction; compile it.
  transpilePackages: ["@csq/core"],
};

export default nextConfig;
