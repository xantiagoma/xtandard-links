/**
 * Regression test for the React-embed CSS scoping (upstream report:
 * @xtandard/links/react/styles.css was a global unscoped Tailwind build that
 * restyled the whole host app): the kit's shared suite, with the links scope,
 * plus the built stylesheet when it exists.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { runEmbedCssSuite } from "@xtandard/kit/build";
import { describe, expect, it } from "vitest";

runEmbedCssSuite(
  { describe, it, expect },
  {
    scope: ".xtandard-links",
    readBuiltCss: () => readFile("dist/react.css", "utf8").catch(() => undefined),
  },
);
