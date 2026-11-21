/** @type {import("next").NextConfig} */
const nextConfig = {
  // Load @xtandard/links from node_modules instead of bundling it, so the panel
  // finds its prebuilt admin UI (dist/ui) next to its own modules.
  serverExternalPackages: ["@xtandard/links"],
};

export default nextConfig;
