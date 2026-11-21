import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createViewerToken,
  DEFAULT_VIEWER_ACTIONS,
  VIEWER_TOKEN_PREFIX,
  ViewerTokenError,
  verifyViewerToken,
} from "../src/portal.ts";
import { base64url, hmacSha256 } from "../src/password.ts";

const SECRET = "viewer-secret";

afterEach(() => {
  vi.useRealTimers();
});

/** Sign an arbitrary payload with the real secret (to test claim validation). */
async function forge(payload: unknown): Promise<string> {
  const part = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${VIEWER_TOKEN_PREFIX}${part}.${base64url(await hmacSha256(SECRET, part))}`;
}

describe("viewer tokens", () => {
  test("round-trips tenant, links and allow", async () => {
    const token = await createViewerToken(SECRET, {
      tenant: "acme",
      links: ["lnk_1", "lnk_2"],
      allow: ["analytics:read"],
    });
    expect(token.startsWith("lvt_")).toBe(true);
    const claims = await verifyViewerToken(SECRET, token);
    expect(claims).toMatchObject({
      tenant: "acme",
      links: ["lnk_1", "lnk_2"],
      allow: ["analytics:read"],
    });
    expect(claims.exp).toBeGreaterThan(Date.now());
  });

  test("defaults: no link set, no allow, 1 day expiry", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const claims = await verifyViewerToken(
      SECRET,
      await createViewerToken(SECRET, { tenant: "a" }),
    );
    expect(claims).toEqual({ tenant: "a", exp: 1_000_000 + 86_400_000 });
    expect(DEFAULT_VIEWER_ACTIONS).toEqual(["analytics:read", "link:read"]);
  });

  test("expires", async () => {
    vi.useFakeTimers({ now: 0 });
    const token = await createViewerToken(SECRET, { tenant: "acme", expiresIn: "1h" });
    vi.setSystemTime(3_600_000);
    await expect(verifyViewerToken(SECRET, token)).rejects.toThrow(/expired/);
  });

  test("rejects a wrong secret, tampered payload and malformed tokens", async () => {
    const token = await createViewerToken(SECRET, { tenant: "acme" });
    await expect(verifyViewerToken("other", token)).rejects.toBeInstanceOf(ViewerTokenError);
    const [payload, sig] = token.slice(4).split(".") as [string, string];
    const tampered = base64url(
      new TextEncoder().encode(JSON.stringify({ tenant: "evil", exp: Date.now() + 1e9 })),
    );
    await expect(verifyViewerToken(SECRET, `lvt_${tampered}.${sig}`)).rejects.toThrow(/signature/);
    await expect(verifyViewerToken(SECRET, `whpt_${payload}.${sig}`)).rejects.toThrow(/prefix/);
    await expect(verifyViewerToken(SECRET, "lvt_onlyonepart")).rejects.toThrow(/malformed/);
    await expect(verifyViewerToken(SECRET, `lvt_${payload}.!!!`)).rejects.toThrow(ViewerTokenError);
  });

  test("validates signed claims", async () => {
    await expect(
      verifyViewerToken(SECRET, await forge({ exp: Date.now() + 1000 })),
    ).rejects.toThrow(/tenant/);
    await expect(verifyViewerToken(SECRET, await forge({ tenant: "a" }))).rejects.toThrow(/expiry/);
    await expect(
      verifyViewerToken(SECRET, await forge({ tenant: "a", exp: Date.now() + 1000, links: "x" })),
    ).rejects.toThrow(/links/);
    await expect(
      verifyViewerToken(SECRET, await forge({ tenant: "a", exp: Date.now() + 1000, allow: [1] })),
    ).rejects.toThrow(/allow/);
    const notJson = base64url(new TextEncoder().encode("not json"));
    const sig = base64url(await hmacSha256(SECRET, notJson));
    await expect(verifyViewerToken(SECRET, `lvt_${notJson}.${sig}`)).rejects.toThrow(/payload/);
  });

  test("refuses to mint without a secret or tenant", async () => {
    await expect(createViewerToken("", { tenant: "a" })).rejects.toThrow(ViewerTokenError);
    await expect(createViewerToken(SECRET, { tenant: "" })).rejects.toThrow(ViewerTokenError);
  });
});
