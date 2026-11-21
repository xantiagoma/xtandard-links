import { describe, expect, test } from "vitest";
import { encode } from "uqr";
import { qrUrl, renderQrSvg, shortUrl } from "../src/qr.ts";

describe("renderQrSvg", () => {
  test("renders a square SVG whose dark modules match the encoder", () => {
    const svg = renderQrSvg("https://sho.rt/abc?qr=1");
    const qr = encode("https://sho.rt/abc?qr=1", { ecc: "M", border: 0 });
    const dim = qr.size + 4;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="256" height="256"/);
    expect(svg).toContain(`viewBox="0 0 ${dim} ${dim}"`);
    expect(svg).toContain('<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>');
    // Count dark modules drawn by the path (runs of h<n>).
    const drawn = [...svg.matchAll(/h(\d+)v1/g)].reduce((n, m) => n + Number(m[1]), 0);
    const dark = qr.data.flat().filter(Boolean).length;
    expect(drawn).toBe(dark);
  });

  test("options: size, margin, colours (sanitized), transparent background, ecc", () => {
    const svg = renderQrSvg("x", {
      size: 100,
      margin: 0,
      foreground: "0af",
      background: "transparent",
      ecc: "H",
    });
    expect(svg).toContain('width="100"');
    expect(svg).toContain('fill="#0af"');
    expect(svg).not.toContain("<rect");
    const evil = renderQrSvg("x", {
      foreground: '"/><script>alert(1)</script>',
      background: "url(x)",
    });
    expect(evil).not.toContain("<script>");
    expect(evil).toContain('fill="#000000"');
    expect(evil).toContain('fill="#ffffff"');
    expect(renderQrSvg("x", { size: 1e9 })).toContain('width="4096"');
    expect(renderQrSvg("x", { foreground: "rgb(1, 2, 3)" })).toContain('fill="rgb(1, 2, 3)"');
    const long = "https://go.example.com/" + "a".repeat(80);
    const dim = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1]);
    expect(dim(renderQrSvg(long, { ecc: "H" }))).toBeGreaterThan(
      dim(renderQrSvg(long, { ecc: "L" })),
    );
  });
});

describe("shortUrl / qrUrl", () => {
  test("https by default, http for local hosts, encoded slug segments, basePath", () => {
    expect(shortUrl({ domain: "go.acme.com", slug: "Spring Sale/2026" })).toBe(
      "https://go.acme.com/Spring%20Sale/2026",
    );
    expect(shortUrl({ domain: "localhost", slug: "x" })).toBe("http://localhost/x");
    expect(shortUrl({ domain: "links.localhost", slug: "x" })).toBe("http://links.localhost/x");
    expect(shortUrl({ domain: "127.0.0.1", slug: "x" })).toBe("http://127.0.0.1/x");
    expect(shortUrl({ domain: "acme.com", slug: "x" }, { basePath: "/l/" })).toBe(
      "https://acme.com/l/x",
    );
    expect(qrUrl({ domain: "go.acme.com", slug: "x" }, { protocol: "http:" })).toBe(
      "http://go.acme.com/x?qr=1",
    );
  });
});
