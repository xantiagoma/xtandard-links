import { describe, expect, test } from "vitest";
import type { Principal } from "../src/auth/contract.ts";
import type { AuthorizeInput, LinksAction, LinksResource } from "../src/authorization/contract.ts";
import { isMutatingAction, MUTATING_ACTIONS } from "../src/authorization/contract.ts";
import { delegatedAuthorization } from "../src/authorization/delegated.ts";
import { noAuthorization } from "../src/authorization/none.ts";
import {
  ALL_ACTIONS,
  DEFAULT_ROLE_POLICY,
  READ_ACTIONS,
  rolesAuthorization,
} from "../src/authorization/roles.ts";

const RESOURCE: LinksResource = { type: "link", tenant: "acme" };

const input = (principal: Principal | null, action: LinksAction): AuthorizeInput => ({
  principal,
  action,
  resource: RESOURCE,
  request: new Request("http://x/"),
});

const admin: Principal = { id: "a", roles: ["admin"] };
const viewer: Principal = { id: "v", roles: ["viewer"] };
const editor: Principal = { id: "e", roles: ["editor"] };

describe("rolesAuthorization (default policy)", () => {
  const authz = rolesAuthorization();

  test("admin is allowed everything", async () => {
    for (const action of ALL_ACTIONS) {
      expect(await authz.authorize(input(admin, action))).toBe(true);
    }
  });

  test("viewer is allowed reads", async () => {
    for (const action of READ_ACTIONS) {
      expect(await authz.authorize(input(viewer, action))).toBe(true);
    }
  });

  test("viewer is denied writes", async () => {
    expect(await authz.authorize(input(viewer, "link:update"))).toBe(false);
    expect(await authz.authorize(input(viewer, "domain:create"))).toBe(false);
    expect(await authz.authorize(input(viewer, "link:create"))).toBe(false);
    expect(await authz.authorize(input(viewer, "link:import"))).toBe(false);
  });

  test("viewer is denied viewer-token:create (delegation, not a plain read)", async () => {
    expect(READ_ACTIONS).not.toContain("viewer-token:create");
    expect(await authz.authorize(input(viewer, "viewer-token:create"))).toBe(false);
  });

  test("editor is allowed writes and token minting", async () => {
    expect(await authz.authorize(input(editor, "link:update"))).toBe(true);
    expect(await authz.authorize(input(editor, "link:create"))).toBe(true);
    expect(await authz.authorize(input(editor, "viewer-token:create"))).toBe(true);
  });

  test("null principal is denied", async () => {
    expect(await authz.authorize(input(null, "link:read"))).toBe(false);
  });

  test("principal with no matching role is denied", async () => {
    expect(await authz.authorize(input({ id: "x", roles: ["nobody"] }, "link:read"))).toBe(false);
    expect(await authz.authorize(input({ id: "x" }, "link:read"))).toBe(false);
  });
});

describe("rolesAuthorization (readonly)", () => {
  const authz = rolesAuthorization({ readonly: true });

  test("blocks mutating actions even for admin", async () => {
    expect(await authz.authorize(input(admin, "link:update"))).toBe(false);
    expect(await authz.authorize(input(admin, "link:create"))).toBe(false);
    expect(await authz.authorize(input(admin, "domain:delete"))).toBe(false);
  });

  test("still allows reads for authorized roles", async () => {
    expect(await authz.authorize(input(admin, "link:read"))).toBe(true);
    expect(await authz.authorize(input(viewer, "audit:read"))).toBe(true);
    // minting does not mutate — readonly leaves it to the role policy.
    expect(await authz.authorize(input(admin, "viewer-token:create"))).toBe(true);
  });
});

describe("rolesAuthorization (custom policy)", () => {
  test("honors an explicit action list", async () => {
    const authz = rolesAuthorization({
      policy: { marketing: ["link:import", "analytics:read"] },
    });
    const marketing: Principal = { id: "o", roles: ["marketing"] };
    expect(await authz.authorize(input(marketing, "link:import"))).toBe(true);
    expect(await authz.authorize(input(marketing, "link:update"))).toBe(false);
  });

  test("DEFAULT_ROLE_POLICY exposes admin/editor/viewer", () => {
    expect(DEFAULT_ROLE_POLICY.admin).toBe("*");
    expect(DEFAULT_ROLE_POLICY.editor).toEqual([...ALL_ACTIONS]);
    expect(DEFAULT_ROLE_POLICY.viewer).toEqual([...READ_ACTIONS]);
  });
});

describe("MUTATING_ACTIONS", () => {
  test("classifies reads as non-mutating and writes as mutating", () => {
    expect(isMutatingAction("link:read")).toBe(false);
    expect(isMutatingAction("viewer-token:create")).toBe(false);
    expect(isMutatingAction("audit:read")).toBe(false);
    expect(isMutatingAction("domain:delete")).toBe(true);
    expect(isMutatingAction("link:create")).toBe(true);
    expect(isMutatingAction("link:import")).toBe(true);
    for (const action of MUTATING_ACTIONS) {
      expect(ALL_ACTIONS).toContain(action);
    }
  });
});

describe("noAuthorization", () => {
  test("allows everything, even for a null principal", async () => {
    const authz = noAuthorization();
    expect(await authz.authorize(input(null, "tenant:delete"))).toBe(true);
  });
});

describe("delegatedAuthorization", () => {
  test("allows when the delegate returns true", async () => {
    const authz = delegatedAuthorization({ authorize: () => true });
    expect(await authz.authorize(input(null, "link:update"))).toBe(true);
  });

  test("denies when the delegate returns false", async () => {
    const authz = delegatedAuthorization({ authorize: () => false });
    expect(await authz.authorize(input(admin, "link:read"))).toBe(false);
  });

  test("normalizes an async delegate and receives the input", async () => {
    const authz = delegatedAuthorization({
      authorize: async ({ action }) => action === "link:read",
    });
    expect(await authz.authorize(input(admin, "link:read"))).toBe(true);
    expect(await authz.authorize(input(admin, "link:update"))).toBe(false);
  });
});
