/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the production Docker image.
  output: "standalone",
  // @csq/core ships raw TypeScript through the workspace junction; compile it.
  transpilePackages: ["@csq/core"],
  // The public landing moved to apps/web (PRD 20A); the dashboard service
  // root goes straight to the tenant dashboard.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default nextConfig;
