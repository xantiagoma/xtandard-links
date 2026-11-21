import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";

let dir: string;
let out: string[];
let err: string[];

const ENV = ["STORAGE_DRIVER", "DEFAULT_DOMAIN", "TENANT", "AUTH_MODE", "PORT"];
const saved: Record<string, string | undefined> = {};

// The `memory` driver is one store per process, so commands share state across
// run() calls; each test uses its own tenant to stay independent.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "links-cli-"));
  for (const k of ENV) saved[k] = process.env[k];
  process.env.STORAGE_DRIVER = "memory";
  process.env.DEFAULT_DOMAIN = "sho.rt";
  delete process.env.TENANT;
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const stdout = () => out.join("");

describe("cli basics", () => {
  test("help exits 0 with --help/-h, 1 with no command; version", async () => {
    expect(await run(["--help"])).toBe(0);
    expect(await run(["-h"])).toBe(0);
    expect(await run([])).toBe(1);
    for (const token of [
      "serve",
      "links create",
      "domains add",
      "import",
      "export",
      "stats",
      "qr",
      "prune",
      "STORAGE_DRIVER",
      "VIEWER_SECRET",
    ]) {
      expect(stdout()).toContain(token);
    }
    out.length = 0;
    expect(await run(["--version"])).toBe(0);
    expect(stdout()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("unknown commands and missing arguments fail with usage", async () => {
    expect(await run(["nope"])).toBe(1);
    expect(await run(["links"])).toBe(1);
    expect(await run(["links", "create"])).toBe(1);
    expect(await run(["links", "get"])).toBe(1);
    expect(await run(["links", "delete"])).toBe(1);
    expect(await run(["domains"])).toBe(1);
    expect(await run(["domains", "add"])).toBe(1);
    expect(await run(["domains", "remove"])).toBe(1);
    expect(await run(["import"])).toBe(1);
    expect(await run(["qr"])).toBe(1);
    expect(err.join("")).toContain("Usage:");
  });
});

describe("links", () => {
  test("create, list, get (by id, slug, domain/slug), delete", async () => {
    expect(
      await run([
        "links",
        "create",
        "--url",
        "https://example.com",
        "--slug",
        "hello",
        "-t",
        "t1",
        "--tag",
        "a,b",
        "--title",
        "Hi",
      ]),
    ).toBe(0);
    expect(stdout()).toContain("https://sho.rt/hello");
    out.length = 0;
    expect(await run(["links", "list", "--tenant", "t1"])).toBe(0);
    expect(stdout()).toMatch(
      /lnk_\w+\s+https:\/\/sho\.rt\/hello\s+→ https:\/\/example\.com\s+\[a,b\]/,
    );
    out.length = 0;
    expect(await run(["links", "list", "--tenant", "t1", "--json"])).toBe(0);
    const [link] = JSON.parse(stdout()) as { id: string; hasPassword: boolean }[];
    expect(link?.hasPassword).toBe(false);
    for (const ref of [link!.id, "hello", "sho.rt/hello"]) {
      out.length = 0;
      expect(await run(["links", "get", ref, "--tenant", "t1"])).toBe(0);
      expect(JSON.parse(stdout()).id).toBe(link!.id);
    }
    expect(await run(["links", "get", "nope", "--tenant", "t1"])).toBe(1);
    expect(await run(["links", "delete", "hello", "--tenant", "t1"])).toBe(0);
    out.length = 0;
    expect(await run(["links", "ls", "--tenant", "t1"])).toBe(0);
    expect(stdout()).toBe("No links.\n");
    expect(await run(["links", "rm", "hello", "--tenant", "t1"])).toBe(1);
  });

  test("errors from the core become exit 1 with a message", async () => {
    expect(await run(["links", "create", "--url", "javascript:alert(1)", "-t", "t2"])).toBe(1);
    expect(err.join("")).toContain("Error:");
  });
});

describe("domains", () => {
  test("add, list, remove (force)", async () => {
    expect(await run(["domains", "add", "go.t3.com", "--tenant", "t3", "--default"])).toBe(0);
    expect(stdout()).toContain("Added go.t3.com (tenant t3)");
    out.length = 0;
    expect(await run(["domains", "list", "--tenant", "t3"])).toBe(0);
    expect(stdout()).toMatch(/★ go\.t3\.com\s+tenant:t3/);
    await run(["links", "create", "--url", "https://a.com", "--tenant", "t3"]);
    expect(await run(["domains", "remove", "go.t3.com"])).toBe(1);
    expect(await run(["domains", "rm", "go.t3.com", "--force"])).toBe(0);
  });
});

describe("import / export", () => {
  test("imports a Bitly export (dry run first), exports native CSV", async () => {
    const file = join(dir, "bitly.csv");
    writeFileSync(
      file,
      "Title,Bitlink,Destination URL\nOne,bit.ly/one4,https://a.com/1\nTwo,bit.ly/two4,https://a.com/2\nBad,bit.ly/bad4,nope\n",
    );
    expect(await run(["import", file, "--tenant", "t4", "--dry-run"])).toBe(2);
    expect(stdout()).toContain("Dry run: 2 created, 0 updated, 0 skipped, 1 errors (3 rows)");
    expect(err.join("")).toContain("row 4:");
    out.length = 0;
    expect(
      await run(["import", file, "--tenant", "t4", "--format", "bitly", "--tag", "migrated"]),
    ).toBe(2);
    expect(stdout()).toContain("2 created");
    const csvPath = join(dir, "out.csv");
    expect(await run(["export", "--tenant", "t4", "-o", csvPath])).toBe(0);
    const csv = readFileSync(csvPath, "utf8");
    expect(csv).toContain("https://sho.rt/one4");
    expect(csv).toContain("migrated");
    out.length = 0;
    expect(await run(["export", "--tenant", "t4"])).toBe(0);
    expect(stdout()).toMatch(/^id,domain,slug/);
    expect(await run(["import", file, "--format", "excel"])).toBe(1);
    expect(await run(["import", file, "--on-conflict", "merge"])).toBe(1);
  });
});

describe("stats, qr, prune", () => {
  test("stats prints totals; qr writes an SVG for a slug or URL; prune reports counts", async () => {
    await run(["links", "create", "--url", "https://a.com", "--slug", "st", "--tenant", "t5"]);
    out.length = 0;
    expect(await run(["stats", "t5", "--days", "7"])).toBe(0);
    expect(stdout()).toContain("t5 — last 7 days");
    expect(stdout()).toContain("clicks 0");
    expect(await run(["stats", "t5", "--link", "st"])).toBe(0);
    expect(await run(["stats", "t5", "--link", "missing"])).toBe(1);
    expect(await run(["stats", "t5", "--days", "0"])).toBe(1);

    const svgPath = join(dir, "st.svg");
    expect(await run(["qr", "st", "-o", svgPath, "--tenant", "t5"])).toBe(0);
    expect(readFileSync(svgPath, "utf8")).toMatch(/^<svg /);
    expect(stdout()).toContain("https://sho.rt/st?qr=1");
    out.length = 0;
    expect(await run(["qr", "https://example.com/x", "--size", "128"])).toBe(0);
    expect(stdout()).toContain('width="128"');
    expect(await run(["qr", "missing", "--tenant", "t5"])).toBe(1);

    out.length = 0;
    expect(await run(["prune"])).toBe(0);
    expect(stdout()).toMatch(
      /^Pruned \d+ click refs and \d+ deferred handoffs\.\nPruned \d+ analytics buckets and \d+ recent events\.\n$/,
    );
  });
});

describe("serve auth", () => {
  // A typo must not fall through to `none` and serve an open admin panel: `run`
  // resolves (a listening server never would) with 1 before anything listens.
  test.each(["basci", "BASIC", "Basic"])(
    "serve rejects unknown AUTH_MODE=%s and exits 1 without listening",
    async (mode) => {
      process.env.AUTH_MODE = mode;
      process.env.PORT = "4519";
      expect(await run(["serve"])).toBe(1);
      expect(err.join("")).toContain(`Unknown AUTH_MODE "${mode}" (expected none or basic)`);
      expect(err.join("")).not.toContain("AUTH_MODE=none");
      expect(stdout()).not.toContain("listening");
    },
  );
});
