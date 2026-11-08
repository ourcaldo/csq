/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the production Docker image.
  output: "standalone",
  // @csq/core and @csq/ui ship raw TypeScript through workspace junctions.
  transpilePackages: ["@csq/core", "@csq/ui"],
  // The public landing moved to apps/web (PRD 20A); the dashboard service
  // root goes straight to the tenant dashboard.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default nextConfig;
