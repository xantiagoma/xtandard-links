/// <reference path="../assets.d.ts" />
import * as React from "react";
import symbolSvg from "../public/symbol.svg?raw";
import { cn } from "../lib/utils.ts";

// The navbar symbol (docs/BRAND.md) is inlined as a data URL so the SPA and the
// React embed render it without serving any asset. On light surfaces the
// gradient switches to the deeper "on light" limes, as the light lockups do.
const toDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const DARK_SRC = toDataUrl(symbolSvg);
const LIGHT_SRC = toDataUrl(
  symbolSvg
    .replace("#D2F55A", "#A9DE2C")
    .replace("#A6E22A", "#86C51C")
    .replace("#79BC12", "#5E9E08"),
);

/** The xtandard-links symbol, themed for light/dark surfaces. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <>
      <img src={LIGHT_SRC} alt="" aria-hidden className={cn("dark:hidden", className)} />
      <img src={DARK_SRC} alt="" aria-hidden className={cn("hidden dark:block", className)} />
    </>
  );
}
