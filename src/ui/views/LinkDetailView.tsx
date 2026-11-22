import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Pencil } from "lucide-react";
import { getLink } from "../api.ts";
import { errorMessage } from "../types.ts";
import { useShell } from "../lib/shell.tsx";
import { describeCondition, ruleTarget, variantPercents } from "../lib/rules.ts";
import { applyUtm, UTM_KEYS } from "../lib/link-form.ts";
import { displayUrl, formatCount, formatDateTime, relativeTime, shortUrl } from "../lib/format.ts";
import { Button } from "@xtandard/kit/ui";
import { CopyButton, EmptyCard, LoadingRow, NoTenant, Page, TagPill } from "../components/bits.tsx";
import { AnalyticsPanel } from "../components/AnalyticsPanel.tsx";
import { RecentEvents } from "../components/RecentEvents.tsx";
import { QrPanel } from "../components/QrPanel.tsx";
import { LinkEditor } from "../components/LinkEditor.tsx";
import { LinkBadges } from "./LinksView.tsx";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function LinkDetailView({ id }: { id: string }) {
  const { tenant, can, go, config, viewer } = useShell();
  const [editing, setEditing] = React.useState<false | "link" | "rules">(false);
  const query = useQuery({
    queryKey: ["link", tenant, id],
    queryFn: () => getLink(tenant, id),
    enabled: !!tenant,
  });

  if (!tenant) return <NoTenant />;
  if (query.isLoading) return <LoadingRow label="Loading link…" />;
  if (query.isError || !query.data) {
    return (
      <Page>
        <EmptyCard>{errorMessage(query.error, "Link not found")}</EmptyCard>
      </Page>
    );
  }
  const link = query.data;
  const short = shortUrl(link);
  const utm = UTM_KEYS.filter((k) => link.utm?.[k]);
  const variantRule = link.rules.find((r) => ruleTarget(r) === "variants");

  return (
    <Page wide>
      <button
        type="button"
        onClick={() => go(viewer ? "/links" : "/")}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Links
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate font-mono text-2xl font-semibold tracking-tight">
              {link.domain}/<span className="text-accent">{link.slug}</span>
            </h1>
            <CopyButton text={short} label="Copy short link" toastMessage="Short link copied" />
          </div>
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[13px] text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">
              {link.title ? `${link.title} · ` : ""}
              {displayUrl(link.url)}
            </span>
            <ArrowUpRight className="size-3.5 shrink-0" />
          </a>
          <div className="mt-2">
            <LinkBadges link={link} />
          </div>
        </div>
        {can("link:update") && (
          <Button icon={<Pencil className="size-3.5" />} onClick={() => setEditing("link")}>
            Edit link
          </Button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-xl border border-border bg-card px-4 py-2">
          <dl className="divide-y divide-border">
            <Row label="Destination">
              <span className="break-all font-mono text-[12px]">
                {utm.length ? applyUtm(link.url, link.utm ?? {}) : link.url}
              </span>
            </Row>
            <Row label="Clicks">
              <span className="font-medium tabular-nums">{formatCount(link.clicks ?? 0)}</span>
              {link.maxClicks !== undefined && (
                <span className="text-muted-foreground">
                  {" "}
                  of {formatCount(link.maxClicks)} allowed
                </span>
              )}
            </Row>
            {link.rules.length > 0 && (
              <Row label={`Rules (${link.rules.length})`}>
                <ol className="flex flex-col gap-1.5">
                  {link.rules.map((r, i) => (
                    <li key={r.id} className="flex min-w-0 gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded bg-accent/15 text-[10px] font-semibold text-accent">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        {r.name ? <span className="font-medium">{r.name}: </span> : null}
                        <span className="text-muted-foreground">
                          {r.when.length ? r.when.map(describeCondition).join(" and ") : "Everyone"}
                        </span>{" "}
                        →{" "}
                        {ruleTarget(r) === "variants" ? (
                          <span>
                            A/B{" "}
                            {(r.variants ?? []).map((v, vi) => (
                              <span key={vi} className="font-mono text-[12px]">
                                {vi > 0 ? " · " : ""}
                                {v.id}: {displayUrl(v.url)} ({variantPercents(r.variants ?? [])[vi]}
                                %)
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="break-all font-mono text-[12px]">
                            {displayUrl(r.url ?? "")}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                {can("link:update") && (
                  <button
                    type="button"
                    onClick={() => setEditing("rules")}
                    className="mt-1.5 text-[12px] text-accent hover:underline"
                  >
                    Edit rules
                  </button>
                )}
              </Row>
            )}
            {link.tags.length > 0 && (
              <Row label="Tags">
                <span className="flex flex-wrap gap-1">
                  {link.tags.map((t) => (
                    <TagPill key={t} tag={t} />
                  ))}
                </span>
              </Row>
            )}
            {(link.ios || link.android || link.deepLink?.path) && (
              <Row label="Mobile">
                <span className="flex flex-col gap-0.5 text-[12.5px]">
                  {link.ios && (
                    <span>
                      <span className="text-muted-foreground">iOS → </span>
                      {displayUrl(link.ios)}
                    </span>
                  )}
                  {link.android && (
                    <span>
                      <span className="text-muted-foreground">Android → </span>
                      {displayUrl(link.android)}
                    </span>
                  )}
                  {link.deepLink?.path && (
                    <span>
                      <span className="text-muted-foreground">Deep link </span>
                      <span className="font-mono">{link.deepLink.path}</span>
                      {link.deepLink.deferred ? (
                        <span className="text-muted-foreground"> (deferred)</span>
                      ) : null}
                    </span>
                  )}
                </span>
              </Row>
            )}
            {link.expiresAt && (
              <Row label="Expires">
                {formatDateTime(link.expiresAt)}{" "}
                <span className="text-muted-foreground">({relativeTime(link.expiresAt)})</span>
                {link.expiredUrl && (
                  <span className="block text-[12px] text-muted-foreground">
                    then → {displayUrl(link.expiredUrl)}
                  </span>
                )}
              </Row>
            )}
            <Row label="Settings">
              <span className="text-[12.5px] text-muted-foreground">
                {link.redirectStatus ?? 302} redirect
                {link.trackConversions ? " · conversion tracking" : ""}
                {link.passQuery === false ? " · query not forwarded" : ""}
                {link.hasPassword ? " · password" : ""}
                {link.indexable ? " · indexable" : ""}
              </span>
            </Row>
            <Row label="Created">
              <span className="text-[12.5px]">
                {formatDateTime(link.createdAt)}
                {link.createdBy ? (
                  <span className="text-muted-foreground"> by {link.createdBy}</span>
                ) : null}
              </span>
            </Row>
          </dl>
        </section>
        <section className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-4 py-5">
          <QrPanel tenant={tenant} link={link} compact />
        </section>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold">Analytics</h2>
      <AnalyticsPanel
        tenant={tenant}
        linkIds={[link.id]}
        links={[link]}
        showLinkBreakdown={false}
        extraCards={
          variantRule
            ? [{ title: "A/B variants", tabs: [{ dim: "variant", label: "Variants" }] }]
            : undefined
        }
      />

      {config.capabilities.events && (
        <div className="mt-4">
          <RecentEvents tenant={tenant} linkIds={[link.id]} links={[link]} showLink={false} />
        </div>
      )}

      <LinkEditor
        open={!!editing}
        link={link}
        initialSection={editing === "rules" ? "rules" : "link"}
        onClose={() => setEditing(false)}
      />
    </Page>
  );
}
