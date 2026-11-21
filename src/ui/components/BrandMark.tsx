/// <reference path="../assets.d.ts" />
import * as React from "react";
import symbolSvg from "../public/symbol.svg?raw";
import symbolLightSvg from "../public/symbol-light.svg?raw";
import { cn } from "@xtandard/kit/ui";

// The navbar symbol (docs/BRAND.md) is inlined as a data URL so the SPA and the
// React embed render it without serving any asset: symbol-light.svg (the light
// lockups' deeper lime) on light surfaces, symbol.svg on dark ones. No tile.
const toDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const DARK_SRC = toDataUrl(symbolSvg);
const LIGHT_SRC = toDataUrl(symbolLightSvg);

/** The xtandard-links symbol, themed for light/dark surfaces. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <>
      <img src={LIGHT_SRC} alt="" aria-hidden className={cn("dark:hidden", className)} />
      <img src={DARK_SRC} alt="" aria-hidden className={cn("hidden dark:block", className)} />
    </>
  );
}
