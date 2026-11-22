// The standalone SPA: theme applied before first paint, an analytics viewer
// token taken from `#token=…` / `?token=…` (and stripped from the address bar)
// and sent as a Bearer credential, so `/config` reports `viewer: true` and the
// shell renders the reduced widget chrome (ADR 0009); browser history routing
// under the injected base path.
import { bootSpa } from "@xtandard/kit/ui";
import { App } from "./App.tsx";
import * as api from "./api.ts";
import { themeStore } from "./theme.ts";
import "./styles.css";

bootSpa({
  App,
  configGlobal: "__LINKS_CONFIG__",
  themeKey: themeStore,
  tokenFromUrl: true,
  api,
});
