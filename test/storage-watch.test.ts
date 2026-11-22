import { describe, expect, it } from "vitest";
import { pgListenNotify, withWatch, type PgNotificationClient } from "../src/storage/watch.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";

describe("pgListenNotify", () => {
  it("LISTENs on the channel and delivers matching notifications", async () => {
    const queries: string[] = [];
    let listener: ((msg: { channel: string; payload?: string }) => void) | undefined;
    const client: PgNotificationClient = {
      async query(sql: string) {
        queries.push(sql);
        return undefined;
      },
      on(_event, l) {
        listener = l;
      },
      removeListener() {
        listener = undefined;
      },
    };

    const base = createMemoryStorage();
    // The channel defaults to the documented "xtandard_links".
    const watched = withWatch(base, pgListenNotify(client));
    const keys: string[] = [];
    const off = await watched.watch("lnk/t/acme/", (e) => keys.push(e.key));

    expect(queries.some((q) => q.includes('LISTEN "xtandard_links"'))).toBe(true);
    // A notification on the right channel + matching prefix is delivered;
    // a foreign channel is ignored.
    listener?.({ channel: "xtandard_links", payload: "lnk/t/acme/links/lnk_1" });
    listener?.({ channel: "some_other_channel", payload: "lnk/t/acme/x" });
    expect(keys).toEqual(["lnk/t/acme/links/lnk_1"]);

    await off();
    expect(queries.some((q) => q.includes("UNLISTEN"))).toBe(true);
    expect(listener).toBeUndefined();
  });
});
