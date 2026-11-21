import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "wouter";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Clock,
  Download,
  Link2,
  Lock,
  Pencil,
  Plus,
  QrCode,
  Search,
  Smartphone,
  Split,
  Trash2,
  Waypoints,
} from "lucide-react";
import {
  deleteLink,
  exportLinksCsv,
  listDomains,
  listLinks,
  listTags,
  updateLink,
} from "../api.ts";
import type { PublicLink } from "../types.ts";
import { errorMessage } from "../types.ts";
import { useShell } from "../lib/shell.tsx";
import {
  displayUrl,
  formatCompact,
  formatCount,
  formatDateTime,
  hostOf,
  relativeTime,
  shortUrl,
} from "../lib/format.ts";
import { cn } from "@xtandard/kit/ui";
import { Button } from "@xtandard/kit/ui";
import { Dropdown, Segmented, TextInput } from "@xtandard/kit/ui";
import {
  ConfirmDialog,
  CopyButton,
  EmptyCard,
  LoadingRow,
  ModalDialog,
  NoTenant,
  Page,
  PageHeader,
  StatusBadge,
  TagPill,
} from "../components/bits.tsx";
import { LinkEditor } from "../components/LinkEditor.tsx";
import { QrPanel } from "../components/QrPanel.tsx";
import { useToast } from "@xtandard/kit/ui";

const PAGE_SIZE = 50;
const ALL = "__all";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Status badges summarising what a link does beyond a plain redirect. */
export function LinkBadges({
  link,
  now = Date.now(),
  className,
}: {
  link: PublicLink;
  now?: number;
  className?: string;
}) {
  const expired =
    (link.expiresAt && Date.parse(link.expiresAt) <= now) ||
    (link.maxClicks !== undefined && (link.clicks ?? 0) >= link.maxClicks);
  const variants = link.rules.some((r) => r.variants?.length);
  const geoRules = link.rules.filter((r) => !r.variants?.length).length;
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {link.disabled && <StatusBadge tone="danger">Disabled</StatusBadge>}
      {link.archived && <StatusBadge>Archived</StatusBadge>}
      {expired ? (
        <StatusBadge tone="warning">Expired</StatusBadge>
      ) : link.expiresAt ? (
        <StatusBadge tone="warning" title={`Expires ${formatDateTime(link.expiresAt)}`}>
          <Clock className="size-3" />
          {relativeTime(link.expiresAt, now)}
        </StatusBadge>
      ) : null}
      {link.hasPassword && (
        <StatusBadge title="Password protected">
          <Lock className="size-3" />
        </StatusBadge>
      )}
      {variants && (
        <StatusBadge tone="info" title="A/B test">
          <Split className="size-3" /> A/B
        </StatusBadge>
      )}
      {geoRules > 0 && (
        <StatusBadge tone="accent" title={`${geoRules} targeting rule${geoRules === 1 ? "" : "s"}`}>
          <Waypoints className="size-3" /> {geoRules}
        </StatusBadge>
      )}
      {(link.ios || link.android || link.deepLink) && (
        <StatusBadge title="Mobile / deep link">
          <Smartphone className="size-3" />
        </StatusBadge>
      )}
    </span>
  );
}

/** Stable hue (0–359) for a string. */
function hue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** A tinted letter tile for the destination host (no third-party favicon fetches). */
function HostTile({ url }: { url: string }) {
  const host = hostOf(url).replace(/^www\./, "");
  const h = hue(host);
  return (
    <span
      aria-hidden
      title={host}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold uppercase"
      style={{
        background: `oklch(0.62 0.12 ${h} / 0.14)`,
        color: `oklch(0.55 0.12 ${h})`,
      }}
    >
      {host.charAt(0) || "·"}
    </span>
  );
}

export function LinksView() {
  const { tenant, can, go, viewer } = useShell();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = React.useState(params.get("q") ?? "");
  const debounced = useDebounced(search.trim(), 250);
  const domain = params.get("domain") ?? "";
  const tag = params.get("tag") ?? "";
  const archived = (params.get("archived") ?? "false") as "true" | "false" | "all";

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  React.useEffect(() => {
    if ((params.get("q") ?? "") !== debounced) setParam("q", debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const filters = { search: debounced, domain, tag, archived };
  const linksQuery = useInfiniteQuery({
    queryKey: ["links", tenant, filters],
    queryFn: ({ pageParam }) =>
      listLinks(tenant, {
        ...filters,
        archived: archived === "false" ? undefined : archived,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!tenant,
    staleTime: 15_000,
  });
  const domainsQuery = useQuery({
    queryKey: ["domains", tenant],
    queryFn: () => listDomains(tenant),
    enabled: !!tenant && can("domain:read"),
    staleTime: 60_000,
  });
  const tagsQuery = useQuery({
    queryKey: ["tags", tenant],
    queryFn: () => listTags(tenant),
    enabled: !!tenant,
    staleTime: 60_000,
  });

  const links = linksQuery.data?.pages.flatMap((p) => p.links) ?? [];
  const total = linksQuery.data?.pages[0]?.total ?? 0;

  const [editor, setEditor] = React.useState<{ open: boolean; link: PublicLink | null }>({
    open: false,
    link: null,
  });
  const [qrFor, setQrFor] = React.useState<PublicLink | null>(null);
  const [deleting, setDeleting] = React.useState<PublicLink | null>(null);

  const archive = useMutation({
    mutationFn: (l: PublicLink) => updateLink(tenant, l.id, { archived: !l.archived }),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ["links", tenant] });
      toast.add("success", l.archived ? "Link archived" : "Link restored", shortUrl(l));
    },
    onError: (err) => toast.add("error", errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (l: PublicLink) => deleteLink(tenant, l.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["links", tenant] });
      void qc.invalidateQueries({ queryKey: ["tags", tenant] });
      toast.add("success", "Link deleted");
      setDeleting(null);
    },
    onError: (err) => toast.add("error", errorMessage(err)),
  });

  const exportCsv = async () => {
    try {
      const blob = await exportLinksCsv(tenant, {
        search: debounced || undefined,
        domain: domain || undefined,
        tag: tag || undefined,
        archived,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tenant}-links.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.add("error", errorMessage(err, "Export failed"));
    }
  };

  if (!tenant) return <NoTenant />;

  const canCreate = can("link:create");
  const canEdit = can("link:update");
  const canDelete = !viewer && can("link:delete");
  const filtered = !!(debounced || domain || tag || archived !== "false");

  return (
    <Page wide>
      <PageHeader
        title="Links"
        description={
          linksQuery.isSuccess ? (
            <>
              {formatCount(total)} {archived === "true" ? "archived " : ""}link
              {total === 1 ? "" : "s"}
              {viewer ? (
                ""
              ) : (
                <>
                  {" "}
                  in <span className="font-mono">{tenant}</span>
                </>
              )}
            </>
          ) : (
            "Branded short links with click analytics."
          )
        }
        actions={
          <>
            {!viewer && (
              <Button icon={<Download className="size-3.5" />} onClick={() => void exportCsv()}>
                Export CSV
              </Button>
            )}
            {canCreate && (
              <Button
                variant="primary"
                icon={<Plus className="size-3.5" />}
                onClick={() => setEditor({ open: true, link: null })}
              >
                New link
              </Button>
            )}
          </>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <TextInput
            aria-label="Search links"
            placeholder="Search slug, URL, title or tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {(domainsQuery.data?.length ?? 0) > 1 && (
          <Dropdown
            aria-label="Domain filter"
            value={domain || ALL}
            onValueChange={(v) => setParam("domain", v === ALL ? "" : v)}
            options={[
              { value: ALL, label: "All domains" },
              ...(domainsQuery.data ?? []).map((d) => ({ value: d.hostname, label: d.hostname })),
            ]}
            className="w-48"
          />
        )}
        {(tagsQuery.data?.length ?? 0) > 0 && (
          <Dropdown
            aria-label="Tag filter"
            value={tag || ALL}
            onValueChange={(v) => setParam("tag", v === ALL ? "" : v)}
            options={[
              { value: ALL, label: "All tags" },
              ...(tagsQuery.data ?? []).map((t) => ({
                value: t.tag,
                label: `${t.tag} (${t.count})`,
              })),
            ]}
            className="w-40"
          />
        )}
        <Segmented
          value={archived}
          onValueChange={(v) => setParam("archived", v === "false" ? "" : v)}
          options={[
            { value: "false", label: "Active" },
            { value: "true", label: "Archived" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {linksQuery.isLoading ? (
        <LoadingRow label="Loading links…" />
      ) : linksQuery.isError ? (
        <EmptyCard>{errorMessage(linksQuery.error, "Failed to load links")}</EmptyCard>
      ) : links.length === 0 ? (
        <EmptyCard
          icon={<Link2 className="size-4" />}
          action={
            canCreate && !filtered ? (
              <Button
                variant="primary"
                icon={<Plus className="size-3.5" />}
                onClick={() => setEditor({ open: true, link: null })}
              >
                Create your first link
              </Button>
            ) : undefined
          }
        >
          {filtered ? "No links match these filters." : "No links yet."}
        </EmptyCard>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Link</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">Tags</th>
                  <th className="px-3 py-2.5 text-right">Clicks</th>
                  <th className="hidden px-3 py-2.5 md:table-cell">Created</th>
                  <th className="w-0 px-3 py-2.5" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {links.map((link) => (
                  <tr
                    key={link.id}
                    className={cn(
                      "group cursor-pointer transition-colors hover:bg-secondary/30",
                      link.archived && "opacity-70",
                    )}
                    onClick={() => go(`/links/${encodeURIComponent(link.id)}`)}
                    data-testid="link-row"
                  >
                    <td className="w-full max-w-0 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <HostTile url={link.url} />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="truncate font-mono text-[13px] font-medium text-foreground">
                              {link.domain}/<span className="text-accent">{link.slug}</span>
                            </span>
                            <CopyButton
                              text={shortUrl(link)}
                              label={`Copy ${link.domain}/${link.slug}`}
                              toastMessage="Short link copied"
                            />
                            <LinkBadges link={link} className="shrink-0 flex-nowrap" />
                          </div>
                          <p
                            className="truncate text-[12px] text-muted-foreground"
                            title={link.url}
                          >
                            {link.title ? (
                              <span className="text-foreground/80">{link.title} · </span>
                            ) : null}
                            {displayUrl(link.url)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 lg:table-cell">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        {link.tags.slice(0, 3).map((t) => (
                          <TagPill
                            key={t}
                            tag={t}
                            active={t === tag}
                            onClick={() => setParam("tag", t === tag ? "" : t)}
                          />
                        ))}
                        {link.tags.length > 3 && (
                          <span className="text-[11px] text-muted-foreground">
                            +{link.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span
                        className="inline-flex items-center gap-1 text-[13px] font-medium tabular-nums"
                        title={`${formatCount(link.clicks ?? 0)} clicks`}
                      >
                        {formatCompact(link.clicks ?? 0)}
                      </span>
                    </td>
                    <td
                      className="hidden whitespace-nowrap px-3 py-3 text-[12px] text-muted-foreground md:table-cell"
                      title={formatDateTime(link.createdAt)}
                    >
                      {relativeTime(link.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <div
                        className="flex items-center justify-end gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconAction label="QR code" onClick={() => setQrFor(link)}>
                          <QrCode className="size-3.5" />
                        </IconAction>
                        {canEdit && (
                          <IconAction
                            label="Edit link"
                            onClick={() => setEditor({ open: true, link })}
                          >
                            <Pencil className="size-3.5" />
                          </IconAction>
                        )}
                        {canEdit && !viewer && (
                          <IconAction
                            label={link.archived ? "Restore link" : "Archive link"}
                            onClick={() => archive.mutate(link)}
                          >
                            {link.archived ? (
                              <ArchiveRestore className="size-3.5" />
                            ) : (
                              <Archive className="size-3.5" />
                            )}
                          </IconAction>
                        )}
                        {canDelete && (
                          <IconAction label="Delete link" danger onClick={() => setDeleting(link)}>
                            <Trash2 className="size-3.5" />
                          </IconAction>
                        )}
                        <ChevronRight className="ml-1 size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linksQuery.hasNextPage && (
            <div className="flex justify-center border-t border-border py-2.5">
              <Button
                size="sm"
                variant="ghost"
                loading={linksQuery.isFetchingNextPage}
                onClick={() => void linksQuery.fetchNextPage()}
              >
                Load more ({formatCount(total - links.length)} left)
              </Button>
            </div>
          )}
        </div>
      )}

      <LinkEditor
        open={editor.open}
        link={editor.link}
        onClose={() => setEditor((e) => ({ ...e, open: false }))}
      />

      <ModalDialog
        open={!!qrFor}
        onClose={() => setQrFor(null)}
        title="QR code"
        description={qrFor ? `${qrFor.domain}/${qrFor.slug}` : undefined}
      >
        {qrFor && <QrPanel tenant={tenant} link={qrFor} />}
        <p className="text-center text-[11.5px] text-muted-foreground">
          Scans are recorded as QR clicks.
        </p>
      </ModalDialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title="Delete link?"
        confirmLabel="Delete link"
        danger
        loading={remove.isPending}
      >
        <p className="text-[13px] text-muted-foreground">
          <span className="font-mono text-foreground">
            {deleting ? `${deleting.domain}/${deleting.slug}` : ""}
          </span>{" "}
          stops redirecting immediately and the slug becomes available again. Archive it instead to
          keep it working but out of the list.
        </p>
      </ConfirmDialog>
    </Page>
  );
}

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
