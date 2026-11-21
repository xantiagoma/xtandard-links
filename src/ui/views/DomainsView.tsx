import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Pencil, Plus, Smartphone, Star, Trash2, TabletSmartphone } from "lucide-react";
import { createDomain, deleteDomain, listDomains, updateDomain } from "../api.ts";
import type { Domain } from "../types.ts";
import { errorMessage, LinksApiError } from "../types.ts";
import { useShell } from "../lib/shell.tsx";
import { displayUrl, formatDate } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "../components/ui-bits.tsx";
import { Segmented, TextInput, ToggleSwitch } from "../components/primitives.tsx";
import {
  ConfirmDialog,
  EmptyCard,
  Field,
  LoadingRow,
  ModalDialog,
  NoTenant,
  Page,
  PageHeader,
  StatusBadge,
} from "../components/bits.tsx";
import { TagInput } from "../components/TagInput.tsx";
import { useToast } from "../components/Toast.tsx";

interface AndroidDraft {
  packageName: string;
  sha256: string[];
}

interface DomainDraft {
  hostname: string;
  owner: "shared" | "tenant";
  rootUrl: string;
  notFoundUrl: string;
  isDefault: boolean;
  caseSensitive: boolean;
  slugLength: string;
  iosAppIds: string[];
  iosPaths: string[];
  android: AndroidDraft[];
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function draftOf(d: Domain | null): DomainDraft {
  return {
    hostname: d?.hostname ?? "",
    owner: d ? (d.tenant ? "tenant" : "shared") : "tenant",
    rootUrl: d?.rootUrl ?? "",
    notFoundUrl: d?.notFoundUrl ?? "",
    isDefault: d?.isDefault ?? false,
    caseSensitive: d?.caseSensitive ?? false,
    slugLength: d?.slugLength ? String(d.slugLength) : "",
    iosAppIds: d?.apps?.ios?.appIds ?? [],
    iosPaths: d?.apps?.ios?.paths ?? [],
    android: (d?.apps?.android ?? []).map((a) => ({
      packageName: a.packageName,
      sha256: a.sha256CertFingerprints,
    })),
  };
}

function toDomain(draft: DomainDraft, tenant: string): Domain {
  const apps: Domain["apps"] = {};
  if (draft.iosAppIds.length) {
    apps.ios = {
      appIds: draft.iosAppIds,
      ...(draft.iosPaths.length ? { paths: draft.iosPaths } : {}),
    };
  }
  const android = draft.android
    .filter((a) => a.packageName.trim())
    .map((a) => ({ packageName: a.packageName.trim(), sha256CertFingerprints: a.sha256 }));
  if (android.length) apps.android = android;
  return {
    hostname: draft.hostname.trim().toLowerCase(),
    ...(draft.owner === "tenant" ? { tenant } : {}),
    ...(draft.rootUrl.trim() ? { rootUrl: draft.rootUrl.trim() } : {}),
    ...(draft.notFoundUrl.trim() ? { notFoundUrl: draft.notFoundUrl.trim() } : {}),
    isDefault: draft.isDefault,
    caseSensitive: draft.caseSensitive,
    ...(draft.slugLength ? { slugLength: Number(draft.slugLength) } : {}),
    ...(apps.ios || apps.android ? { apps } : {}),
  };
}

function DomainEditor({
  open,
  domain,
  onClose,
}: {
  open: boolean;
  domain: Domain | null;
  onClose: () => void;
}) {
  const { tenant } = useShell();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState(() => draftOf(domain));
  const [attempted, setAttempted] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDraft(draftOf(domain));
      setAttempted(false);
    }
  }, [open, domain, tenant]);
  const set = <K extends keyof DomainDraft>(k: K, v: DomainDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const hostError = !HOSTNAME_RE.test(draft.hostname.trim().toLowerCase())
    ? "A hostname like go.acme.com (no scheme, no path)"
    : null;

  const save = useMutation({
    mutationFn: () => {
      const body = toDomain(draft, tenant);
      if (domain) {
        // Clearing optional fields needs explicit nulls on update.
        const patch: Record<string, unknown> = { ...body };
        delete patch.hostname;
        for (const k of ["rootUrl", "notFoundUrl", "apps", "tenant"] as const) {
          if (!(k in body)) patch[k] = null;
        }
        // Changing case sensitivity is refused while links exist; only send it when it changed.
        if (body.caseSensitive === (domain.caseSensitive ?? false)) delete patch.caseSensitive;
        return updateDomain(domain.hostname, patch as Partial<Domain>);
      }
      return createDomain(body);
    },
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["domains"] });
      toast.add("success", domain ? "Domain saved" : "Domain added", d.hostname);
      onClose();
    },
    onError: (err) => toast.add("error", errorMessage(err, "Failed to save domain")),
  });

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      wide
      title={domain ? `Edit ${domain.hostname}` : "Add domain"}
      description="DNS and TLS for the hostname stay with your edge; point it at the redirect handler."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setAttempted(true);
              if (!hostError) save.mutate();
            }}
          >
            {domain ? "Save domain" : "Add domain"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Hostname" htmlFor="domain-host" error={attempted ? hostError : null}>
          <TextInput
            id="domain-host"
            className="font-mono"
            placeholder="go.acme.com"
            value={draft.hostname}
            disabled={!!domain}
            onChange={(e) => set("hostname", e.target.value)}
          />
        </Field>
        <Field label="Available to">
          <Segmented
            value={draft.owner}
            onValueChange={(v) => set("owner", v)}
            options={[
              {
                value: "tenant",
                label: (
                  <>
                    Only <span className="font-mono">{tenant}</span>
                  </>
                ),
              },
              { value: "shared", label: "Every tenant" },
            ]}
          />
        </Field>
        <Field label="Root URL" htmlFor="domain-root" hint="Where the bare domain (/) redirects.">
          <TextInput
            id="domain-root"
            placeholder="https://acme.com"
            value={draft.rootUrl}
            onChange={(e) => set("rootUrl", e.target.value)}
          />
        </Field>
        <Field
          label="Not-found URL"
          htmlFor="domain-404"
          hint="Where unknown slugs go (default: a 404 page)."
        >
          <TextInput
            id="domain-404"
            placeholder="https://acme.com/404"
            value={draft.notFoundUrl}
            onChange={(e) => set("notFoundUrl", e.target.value)}
          />
        </Field>
        <Field label="Generated slug length" htmlFor="domain-slug-length">
          <TextInput
            id="domain-slug-length"
            type="number"
            min={3}
            max={32}
            placeholder="7"
            value={draft.slugLength}
            onChange={(e) => set("slugLength", e.target.value)}
          />
        </Field>
      </div>
      <div className="divide-y divide-border rounded-xl border border-border px-4">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div>
            <p className="text-[13px] font-medium">Default domain</p>
            <p className="text-[11.5px] text-muted-foreground">
              New links land here unless they pick another.
            </p>
          </div>
          <ToggleSwitch
            checked={draft.isDefault}
            onCheckedChange={(v) => set("isDefault", v)}
            aria-label="Default domain"
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div>
            <p className="text-[13px] font-medium">Case-sensitive slugs</p>
            <p className="text-[11.5px] text-muted-foreground">
              Off (default): <span className="font-mono">/Sale</span> and{" "}
              <span className="font-mono">/sale</span> are the same link.
            </p>
          </div>
          <ToggleSwitch
            checked={draft.caseSensitive}
            onCheckedChange={(v) => set("caseSensitive", v)}
            aria-label="Case-sensitive slugs"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border px-4 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          <TabletSmartphone className="size-3.5 text-muted-foreground" /> iOS app
          (apple-app-site-association)
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="App IDs" hint="TEAMID.bundle.id">
            <TagInput
              aria-label="iOS app IDs"
              values={draft.iosAppIds}
              onChange={(v) => set("iosAppIds", v)}
              placeholder="ABCDE12345.com.acme.app"
            />
          </Field>
          <Field label="Paths" hint="Default: every path.">
            <TagInput
              aria-label="iOS paths"
              values={draft.iosPaths}
              onChange={(v) => set("iosPaths", v)}
              placeholder="/product/*"
            />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Smartphone className="size-3.5 text-muted-foreground" /> Android apps (assetlinks.json)
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={() => set("android", [...draft.android, { packageName: "", sha256: [] }])}
          >
            Add app
          </Button>
        </div>
        {draft.android.length === 0 && (
          <p className="mt-2 text-[12px] text-muted-foreground">No Android apps.</p>
        )}
        {draft.android.map((a, i) => (
          <div
            key={i}
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[14rem_minmax(0,1fr)_auto]"
          >
            <TextInput
              aria-label={`Android package ${i + 1}`}
              className="font-mono"
              placeholder="com.acme.app"
              value={a.packageName}
              onChange={(e) =>
                set(
                  "android",
                  draft.android.map((x, j) =>
                    j === i ? { ...x, packageName: e.target.value } : x,
                  ),
                )
              }
            />
            <TagInput
              aria-label={`Android fingerprints ${i + 1}`}
              values={a.sha256}
              uppercase
              onChange={(v) =>
                set(
                  "android",
                  draft.android.map((x, j) => (j === i ? { ...x, sha256: v } : x)),
                )
              }
              placeholder="SHA-256 fingerprint AA:BB:…"
            />
            <button
              type="button"
              aria-label={`Remove Android app ${i + 1}`}
              onClick={() =>
                set(
                  "android",
                  draft.android.filter((_, j) => j !== i),
                )
              }
              className="self-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ModalDialog>
  );
}

export function DomainsView() {
  const { tenant, can } = useShell();
  const toast = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["domains", tenant],
    queryFn: () => listDomains(tenant),
    enabled: !!tenant,
  });
  const [editor, setEditor] = React.useState<{ open: boolean; domain: Domain | null }>({
    open: false,
    domain: null,
  });
  const [deleting, setDeleting] = React.useState<Domain | null>(null);
  const [force, setForce] = React.useState(false);

  const remove = useMutation({
    mutationFn: (d: Domain) => deleteDomain(d.hostname, force),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["domains"] });
      toast.add("success", "Domain removed");
      setDeleting(null);
    },
    onError: (err) => {
      if (err instanceof LinksApiError && err.status === 409) {
        toast.add(
          "warning",
          "The domain still has links",
          "Tick “also delete its links” to force it.",
        );
      } else toast.add("error", errorMessage(err));
    },
  });

  if (!tenant) return <NoTenant />;
  const domains = [...(query.data ?? [])].sort(
    (a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.hostname.localeCompare(b.hostname),
  );
  const canWrite = can("domain:update");

  return (
    <Page>
      <PageHeader
        title="Domains"
        description={
          <>
            Short-link hostnames available to <span className="font-mono">{tenant}</span>: shared
            ones and its own branded domains.
          </>
        }
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => setEditor({ open: true, domain: null })}
            >
              Add domain
            </Button>
          )
        }
      />
      {query.isLoading ? (
        <LoadingRow label="Loading domains…" />
      ) : query.isError ? (
        <EmptyCard>{errorMessage(query.error)}</EmptyCard>
      ) : domains.length === 0 ? (
        <EmptyCard icon={<Globe className="size-4" />}>
          No domains yet. Add one (e.g. <span className="font-mono">go.acme.com</span>) and point
          its DNS at your redirect handler.
        </EmptyCard>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {domains.map((d) => (
            <article
              key={d.hostname}
              className="flex flex-col rounded-xl border border-border bg-card"
              data-testid="domain-card"
            >
              <div className="flex items-start gap-3 px-4 pt-4">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    d.tenant ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground",
                  )}
                >
                  <Globe className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-1.5 truncate font-mono text-[15px] font-semibold">
                    {d.hostname}
                    {d.isDefault && (
                      <Star
                        className="size-3.5 fill-current text-warning"
                        aria-label="Default domain"
                      />
                    )}
                  </h2>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.tenant ? (
                      <StatusBadge tone="accent">Branded · {d.tenant}</StatusBadge>
                    ) : (
                      <StatusBadge>Shared</StatusBadge>
                    )}
                    {d.isDefault && <StatusBadge tone="warning">Default</StatusBadge>}
                    {d.caseSensitive && <StatusBadge>Case-sensitive</StatusBadge>}
                    {d.apps?.ios && <StatusBadge tone="info">iOS app</StatusBadge>}
                    {d.apps?.android?.length ? (
                      <StatusBadge tone="info">Android app</StatusBadge>
                    ) : null}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label={`Edit ${d.hostname}`}
                      onClick={() => setEditor({ open: true, domain: d })}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${d.hostname}`}
                      onClick={() => {
                        setForce(false);
                        setDeleting(d);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <dl className="mt-3 grid flex-1 content-start grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border px-4 py-3 text-[12.5px]">
                <dt className="text-muted-foreground">Root</dt>
                <dd className="truncate">
                  {d.rootUrl ? (
                    displayUrl(d.rootUrl)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Not found</dt>
                <dd className="truncate">
                  {d.notFoundUrl ? (
                    displayUrl(d.notFoundUrl)
                  ) : (
                    <span className="text-muted-foreground">404 page</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Slugs</dt>
                <dd>{d.slugLength ?? 7} chars generated</dd>
                {d.apps?.ios && (
                  <>
                    <dt className="text-muted-foreground">iOS</dt>
                    <dd className="truncate font-mono text-[11.5px]">
                      {d.apps.ios.appIds.join(", ")}
                    </dd>
                  </>
                )}
                {d.apps?.android?.map((a) => (
                  <React.Fragment key={a.packageName}>
                    <dt className="text-muted-foreground">Android</dt>
                    <dd className="truncate font-mono text-[11.5px]">{a.packageName}</dd>
                  </React.Fragment>
                ))}
                <dt className="text-muted-foreground">Added</dt>
                <dd>{formatDate(d.createdAt)}</dd>
              </dl>
            </article>
          ))}
        </div>
      )}

      <DomainEditor
        open={editor.open}
        domain={editor.domain}
        onClose={() => setEditor((e) => ({ ...e, open: false }))}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Remove ${deleting?.hostname ?? ""}?`}
        confirmLabel="Remove domain"
        danger
        loading={remove.isPending}
      >
        <p className="text-[13px] text-muted-foreground">
          Links on this domain stop resolving. A domain that still has links is only removed when
          you also delete them.
        </p>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="accent-[var(--destructive)]"
          />
          Also delete its links
        </label>
      </ConfirmDialog>
    </Page>
  );
}
