/** Idempotent boot seed: a couple of links so there is something to click. */
import type { LinksCore } from "@xtandard/links";

export async function seedIfEmpty(core: LinksCore): Promise<void> {
  const { total } = await core.listLinks("default", { limit: 1 });
  if (total > 0) return;
  await core.createLink({
    slug: "docs",
    url: "https://me.xantiagoma.com/xtandard-links/",
    title: "Documentation",
    tags: ["docs"],
    utm: { source: "example", medium: "shortlink" },
  });
  await core.createLink({
    slug: "gh",
    url: "https://github.com/xantiagoma/xtandard-links",
    title: "GitHub repository",
    tags: ["code"],
  });
}
