/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the production Docker image.
  output: "standalone",
  images: {
    // Marketing page uses placeholder photography via picsum while real product
    // screenshots are pending. Listed so next/image will handle them.
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos", pathname: "/**" },
    ],
  },
};

export default nextConfig;
