import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Everything the host app calls is proxied to the demo server started by start.ts,
// so it looks same-origin — like your own backend would be:
//   /links         → the links panel API (what <LinksDashboard> and <LinkAnalytics> call)
//   /viewer-token  → the host app's session-guarded mint route (stand-in)
// Cross-origin works too: point `apiBaseUrl` at the panel and set its `cors` option.
const PANEL = "http://localhost:3702";

export default defineConfig({
  plugins: [react()],
  server: { port: 5191, proxy: { "/links": PANEL, "/viewer-token": PANEL } },
});
