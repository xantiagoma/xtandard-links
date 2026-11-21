/**
 * TEMPORARY: `src/react.tsx` (the `@xtandard/links/react` entry) has not landed
 * yet. TypeScript resolves the real module first (examples/tsconfig.json `paths`)
 * and only falls back to this ambient declaration when the file is missing, so
 * this shim goes inert once it lands — delete it then.
 */
declare module "@xtandard/links/react" {
  import type { ReactElement } from "react";

  export function LinksDashboard(props: { apiBaseUrl: string }): ReactElement;
  export function LinkAnalytics(props: { apiBaseUrl: string; token: string }): ReactElement;
}
