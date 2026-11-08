import type { Config } from "tailwindcss";

// Shared design system via the @csq/ui preset (PRD 12); this app adds only
// its content globs. The preset carries colors/radius/fonts/plugins.
const preset = require("@csq/ui/src/tailwind-preset.cjs");

const config: Config = {
  presets: [preset],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
