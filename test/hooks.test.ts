import { describe, expect, it, vi } from "vitest";
import {
  defaultHookErrorReporter,
  type AfterEvent,
  type BeforeEvent,
} from "../src/hooks/contract.ts";
import { createLogHook } from "../src/hooks/log.ts";

const beforeEvent: BeforeEvent = { type: "tenant.delete", tenant: "acme", actor: null };
const afterEvent: AfterEvent = {
  type: "tenant.deleted",
  tenant: "acme",
  at: "2026-07-04T12:00:00.000Z",
  actor: null,
};

describe("defaultHookErrorReporter", () => {
  it("warns with the [@xtandard/links] prefix and never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => defaultHookErrorReporter(new Error("x"), afterEvent)).not.toThrow();
    expect(warn.mock.calls[0]?.[0]).toBe(
      '[@xtandard/links] after-hook for "tenant.deleted" threw:',
    );
    warn.mockRestore();
  });
});

describe("createLogHook", () => {
  it("logs after events with the package prefix", async () => {
    const lines: string[] = [];
    const hook = createLogHook({ log: (l) => void lines.push(l) });
    await hook.after?.(afterEvent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[@xtandard/links] after tenant.deleted");
    expect(hook.before).toBeUndefined();
  });

  it("optionally logs before events and never denies", async () => {
    const lines: string[] = [];
    const hook = createLogHook({ log: (l) => void lines.push(l), includeBefore: true });
    await expect(Promise.resolve(hook.before?.(beforeEvent))).resolves.toBeUndefined();
    expect(lines[0]).toContain("before tenant.delete");
  });
});
