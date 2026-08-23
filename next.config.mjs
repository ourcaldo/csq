/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the production Docker image.
  output: "standalone",
  images: {
    // Marketing page uses Unsplash portraits/scenes. Listed explicitly so
    // next/image will optimize them.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
