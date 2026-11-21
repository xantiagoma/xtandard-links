/**
 * Express + @xtandard/links — the admin panel and the redirect plane as
 * middleware, in front of your own (body-parsed) routes.
 *
 *   bun add express @xtandard/links      # or npm / pnpm — runs on Node too
 *   bun run src/index.ts
 *
 * Then:
 *   - GET  /links      → the admin panel.
 *   - GET  /docs       → a short link → redirect.
 *   - POST /signup     → your own JSON route (express.json() still sees the body).
 */
import express from "express";
import { linksPanel, linksRedirect } from "@xtandard/links/express";
import { createFileStorage } from "@xtandard/links/storage/file";

const port = Number(process.env.PORT) || 3000;

const panel = linksPanel({
  storage: createFileStorage({ dir: "./.links" }),
  basePath: "/links",
  title: "Acme Links",
  defaultDomain: "localhost",
});

if ((await panel.core.listLinks("default", { limit: 1 })).total === 0) {
  await panel.core.createLink({
    slug: "docs",
    url: "https://me.xantiagoma.com/xtandard-links/",
    title: "Documentation",
    trackConversions: true, // the destination gets ?xl_id=clk_… for /signup to attribute
  });
}

const app = express();

// 1. Panel BEFORE any body parser: it reads the raw request body itself.
app.use("/links", panel);

// 2. Short links; next() for everything else. Only a password-form POST for one
//    of its links reads the body, so the parsers below still see untouched streams.
app.use(linksRedirect({ core: panel.core }));

// 3. Your app.
app.use(express.json());

app.get("/", (_req, res) => {
  res
    .type("html")
    .send(`<h1>Acme</h1><p><a href="/docs">/docs</a> · <a href="/links">panel</a></p>`);
});

// A signup that reports a lead for the click that brought the visitor.
app.post("/signup", async (req, res) => {
  const { email, clickId } = (req.body ?? {}) as { email?: string; clickId?: string };
  const customerId = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const lead = await panel.core.trackLead({
    customerId,
    ...(clickId ? { clickId } : {}),
    ...(email ? { customerEmail: email } : {}),
  });
  res
    .status(201)
    .json({ customerId, attributed: lead !== null, linkId: lead?.event.linkId ?? null });
});

app.listen(port, () => {
  console.log(`Express listening on http://localhost:${port} (panel at /links, try /docs)`);
});
