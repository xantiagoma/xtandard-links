import React from "react";
import { createRoot } from "react-dom/client";
import { useBrowserLocation } from "wouter/use-browser-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import { setApiToken } from "./api.ts";
import { ToastProvider } from "./components/Toast.tsx";
import { initTheme } from "./theme.ts";
import "./styles.css";

// Apply the persisted theme before first paint.
initTheme();

// Standalone widget affordance: `?token=lvt_…` attaches an analytics viewer
// token as a Bearer credential on every API request; `/config` then reports
// `viewer: true` and the shell renders the reduced widget chrome (ADR 0009).
const token = new URLSearchParams(window.location.search).get("token");
if (token) setApiToken(token);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

// The panel handler serves the SPA as a catch-all under its basePath, so use
// real browser-history routing for clean, deep-linkable paths.
const basePath = (window.__LINKS_CONFIG__?.basePath ?? "").replace(/\/$/, "");

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App locationHook={useBrowserLocation} base={basePath} />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
