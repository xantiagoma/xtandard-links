/**
 * Create / edit a link in a side drawer. Sections: the link itself, UTM
 * builder, targeting rules, mobile + deep links, link preview (OG) and
 * advanced settings (expiry, password, redirect status, toggles).
 *
 * @module
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, KeyRound, Shuffle, Smartphone, TabletSmartphone } from "lucide-react";
import { createLink, listDomains, listTags, updateLink } from "../api.ts";
import type { PublicLink } from "../types.ts";
import { errorMessage } from "../types.ts";
import {
  applyUtm,
  draftFromLink,
  draftToCreateInput,
  draftToPatch,
  extractUtm,
  generateSlug,
  isDirty,
  slugIssue,
  UTM_KEYS,
  type LinkDraft,
} from "../lib/link-form.ts";
import { validateRules } from "../lib/rules.ts";
import { displayUrl, hostOf, shortUrl } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { useShell } from "../lib/shell.tsx";
import { Button } from "./ui-bits.tsx";
import { Dropdown, Segmented, TextArea, TextInput, ToggleSwitch } from "./primitives.tsx";
import { ConfirmDialog, Drawer, Field } from "./bits.tsx";
import { TagInput } from "./TagInput.tsx";
import { RulesEditor } from "./RulesEditor.tsx";
import { useToast } from "./Toast.tsx";

type Section = "link" | "utm" | "rules" | "mobile" | "preview" | "advanced";

const isUrl = (s: string) => {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
};

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      </div>
      <ToggleSwitch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function LinkEditor({
  open,
  onClose,
  link,
  onSaved,
  initialSection = "link",
}: {
  open: boolean;
  onClose: () => void;
  /** Edit this link; omit to create. */
  link?: PublicLink | null;
  onSaved?: (link: PublicLink) => void;
  initialSection?: Section;
}) {
  const { tenant, can } = useShell();
  const toast = useToast();
  const qc = useQueryClient();
  const editing = !!link;

  const domainsQuery = useQuery({
    queryKey: ["domains", tenant],
    queryFn: () => listDomains(tenant),
    enabled: open && !!tenant,
    retry: false,
    staleTime: 60_000,
  });
  const tagsQuery = useQuery({
    queryKey: ["tags", tenant],
    queryFn: () => listTags(tenant),
    enabled: open && !!tenant,
    retry: false,
    staleTime: 60_000,
  });
  const domains = domainsQuery.data ?? [];
  const defaultDomain =
    domains.find((d) => d.isDefault && d.tenant === tenant)?.hostname ??
    domains.find((d) => d.isDefault)?.hostname ??
    domains[0]?.hostname ??
    "";

  const [draft, setDraft] = React.useState<LinkDraft>(() => draftFromLink(link));
  const [section, setSection] = React.useState<Section>(initialSection);
  const [attempted, setAttempted] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  // Reset whenever the drawer opens on a (different) link.
  React.useEffect(() => {
    if (open) {
      setDraft(draftFromLink(link));
      setSection(initialSection);
      setAttempted(false);
    }
  }, [open, link, initialSection]);

  // New links start on the tenant's default domain once domains load.
  React.useEffect(() => {
    if (open && !editing && !draft.domain && defaultDomain) {
      setDraft((d) => ({ ...d, domain: defaultDomain }));
    }
  }, [open, editing, draft.domain, defaultDomain]);

  const set = <K extends keyof LinkDraft>(key: K, value: LinkDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const urlError = !draft.url.trim()
    ? "A destination is required"
    : !isUrl(draft.url.trim())
      ? "Enter a full URL, e.g. https://acme.com/pricing"
      : null;
  const slugError = slugIssue(draft.slug.trim());
  const ruleIssues = validateRules(draft.rules);
  const passwordError =
    draft.passwordMode === "set" && draft.password.length < 4 ? "At least 4 characters" : null;
  const valid = !urlError && !slugError && ruleIssues.length === 0 && !passwordError;

  const save = useMutation({
    mutationFn: () =>
      link
        ? updateLink(tenant, link.id, draftToPatch(draft, link))
        : createLink(tenant, draftToCreateInput(draft)),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["links", tenant] });
      void qc.invalidateQueries({ queryKey: ["link", tenant, saved.id] });
      void qc.invalidateQueries({ queryKey: ["tags", tenant] });
      toast.add("success", editing ? "Link saved" : "Link created", shortUrl(saved));
      onSaved?.(saved);
      onClose();
    },
    onError: (err) => toast.add("error", errorMessage(err, "Failed to save link")),
  });

  const submit = () => {
    setAttempted(true);
    if (!valid) {
      if (urlError || slugError) setSection("link");
      else if (ruleIssues.length) setSection("rules");
      else if (passwordError) setSection("advanced");
      return;
    }
    save.mutate();
  };

  const dirty = isDirty(draft, link);
  const requestClose = () => (dirty && !save.isPending ? setConfirmDiscard(true) : onClose());

  const utmCount = UTM_KEYS.filter((k) => draft.utm[k].trim()).length;
  const sections: { value: Section; label: React.ReactNode }[] = [
    { value: "link", label: "Link" },
    { value: "utm", label: <>UTM{utmCount ? <Count n={utmCount} /> : null}</> },
    {
      value: "rules",
      label: <>Rules{draft.rules.length ? <Count n={draft.rules.length} /> : null}</>,
    },
    { value: "mobile", label: "Mobile" },
    { value: "preview", label: "Preview" },
    { value: "advanced", label: "Advanced" },
  ];

  const previewShort = draft.domain
    ? `${draft.domain}/${draft.slug.trim() || "…"}`
    : draft.slug.trim() || "generated on save";

  return (
    <>
      <Drawer
        open={open}
        onClose={requestClose}
        title={editing ? `Edit ${link!.domain}/${link!.slug}` : "New link"}
        description={
          editing ? link!.url : "A branded short link with analytics, rules and deep links."
        }
        footer={
          <>
            {attempted && !valid && (
              <span className="mr-auto text-[12px] text-destructive">
                Fix the highlighted fields
              </span>
            )}
            <Button variant="secondary" onClick={requestClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={editing && !dirty}
              onClick={submit}
            >
              {editing ? "Save changes" : "Create link"}
            </Button>
          </>
        }
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-6 py-2.5 backdrop-blur">
          <Segmented value={section} onValueChange={setSection} options={sections} />
        </div>

        <div className="px-6 py-5">
          {section === "link" && (
            <div className="flex flex-col gap-4">
              <Field
                label="Destination URL"
                htmlFor="link-url"
                error={attempted ? urlError : null}
                hint="Paste a URL with utm_ parameters and they move into the UTM builder."
              >
                <TextInput
                  id="link-url"
                  autoFocus
                  placeholder="https://acme.com/pricing"
                  value={draft.url}
                  onChange={(e) => set("url", e.target.value)}
                  onBlur={() => {
                    const found = extractUtm(draft.url.trim());
                    if (found) {
                      setDraft((d) => ({ ...d, url: found.url, utm: { ...d.utm, ...found.utm } }));
                      toast.add("info", "UTM parameters moved to the UTM builder");
                    }
                  }}
                />
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <Field label="Domain">
                  {domains.length ? (
                    <Dropdown
                      aria-label="Domain"
                      value={draft.domain}
                      onValueChange={(v) => set("domain", v)}
                      options={domains.map((d) => ({
                        value: d.hostname,
                        label: d.hostname,
                        description: d.tenant ? `${d.tenant}'s domain` : "Shared",
                      }))}
                      className="w-full"
                    />
                  ) : (
                    <TextInput
                      aria-label="Domain"
                      placeholder="default domain"
                      value={draft.domain}
                      onChange={(e) => set("domain", e.target.value.trim().toLowerCase())}
                    />
                  )}
                </Field>
                <Field
                  label="Slug"
                  htmlFor="link-slug"
                  error={slugError}
                  hint={draft.slug ? undefined : "Leave empty to generate one."}
                >
                  <div className="flex gap-2">
                    <TextInput
                      id="link-slug"
                      placeholder="spring-sale"
                      value={draft.slug}
                      onChange={(e) => set("slug", e.target.value)}
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label="Generate slug"
                      title="Generate a random slug"
                      onClick={() => {
                        const d = domains.find((x) => x.hostname === draft.domain);
                        set("slug", generateSlug(d?.slugLength ?? 7, d?.caseSensitive ?? false));
                      }}
                      className="h-9 w-9"
                    >
                      <Shuffle className="size-3.5" />
                    </Button>
                  </div>
                </Field>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2 text-[12.5px]">
                <span className="text-muted-foreground">Short link</span>
                <span
                  className="truncate font-mono font-medium text-foreground"
                  data-testid="short-preview"
                >
                  {previewShort}
                </span>
                {draft.url && isUrl(draft.url) && (
                  <span className="ml-auto truncate text-muted-foreground">
                    → {hostOf(draft.url)}
                  </span>
                )}
              </div>

              <Field label="Title" htmlFor="link-title">
                <TextInput
                  id="link-title"
                  placeholder="Spring sale landing page"
                  value={draft.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>
              <Field label="Description" htmlFor="link-description">
                <TextArea
                  id="link-description"
                  rows={2}
                  placeholder="Internal note"
                  value={draft.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>
              <Field label="Tags">
                <TagInput
                  aria-label="Tags"
                  values={draft.tags}
                  onChange={(tags) => set("tags", tags)}
                  lowercase
                  suggestions={(tagsQuery.data ?? []).map((t) => t.tag)}
                  placeholder="campaign, social…"
                />
              </Field>
            </div>
          )}

          {section === "utm" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {UTM_KEYS.map((k) => (
                  <Field key={k} label={`utm_${k}`} htmlFor={`utm-${k}`}>
                    <TextInput
                      id={`utm-${k}`}
                      className="font-mono"
                      placeholder={
                        {
                          source: "newsletter",
                          medium: "email",
                          campaign: "spring_sale",
                          term: "running shoes",
                          content: "hero_cta",
                        }[k]
                      }
                      value={draft.utm[k]}
                      onChange={(e) => set("utm", { ...draft.utm, [k]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
              <Field label="Final destination">
                <code className="block break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[12px] text-foreground">
                  {draft.url ? applyUtm(draft.url.trim(), draft.utm) : "Set a destination first"}
                </code>
              </Field>
              <p className="text-[11.5px] text-muted-foreground">
                Parameters already present on the destination win. Clicks record the UTM values for
                the analytics breakdowns.
              </p>
            </div>
          )}

          {section === "rules" && (
            <RulesEditor
              rules={draft.rules}
              onChange={(rules) => set("rules", rules)}
              defaultUrl={draft.url}
              showIssues={attempted}
            />
          )}

          {section === "mobile" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <TabletSmartphone className="size-3.5" /> iOS destination
                    </span>
                  }
                  htmlFor="link-ios"
                  hint="App Store listing or a universal link."
                >
                  <TextInput
                    id="link-ios"
                    placeholder="https://apps.apple.com/app/id123456789"
                    value={draft.ios}
                    onChange={(e) => set("ios", e.target.value)}
                  />
                </Field>
                <Field
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Smartphone className="size-3.5" /> Android destination
                    </span>
                  }
                  htmlFor="link-android"
                  hint="Play Store listing or an app link."
                >
                  <TextInput
                    id="link-android"
                    placeholder="https://play.google.com/store/apps/details?id=com.acme"
                    value={draft.android}
                    onChange={(e) => set("android", e.target.value)}
                  />
                </Field>
              </div>
              <Field
                label="Deep link path"
                htmlFor="link-deeplink"
                hint="In-app path handed to the app when it opens from this link (needs the domain's app association)."
              >
                <TextInput
                  id="link-deeplink"
                  className="font-mono"
                  placeholder="/product/42"
                  value={draft.deepLinkPath}
                  onChange={(e) => set("deepLinkPath", e.target.value)}
                />
              </Field>
              <ToggleRow
                label="Deferred deep link"
                hint="Remember the path on mobile clicks so the app can claim it after install."
                checked={draft.deepLinkDeferred}
                onChange={(v) => set("deepLinkDeferred", v)}
              />
            </div>
          )}

          {section === "preview" && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <Field label="Preview title" htmlFor="og-title">
                  <TextInput
                    id="og-title"
                    placeholder={draft.title || "Shown when the link is shared"}
                    value={draft.previewTitle}
                    onChange={(e) => set("previewTitle", e.target.value)}
                  />
                </Field>
                <Field label="Preview description" htmlFor="og-description">
                  <TextArea
                    id="og-description"
                    rows={3}
                    value={draft.previewDescription}
                    onChange={(e) => set("previewDescription", e.target.value)}
                  />
                </Field>
                <Field label="Preview image URL" htmlFor="og-image">
                  <TextInput
                    id="og-image"
                    placeholder="https://acme.com/og/spring.png"
                    value={draft.previewImage}
                    onChange={(e) => set("previewImage", e.target.value)}
                  />
                </Field>
                <p className="text-[11.5px] text-muted-foreground">
                  Served to unfurlers (Slack, X, iMessage…) instead of the destination's own tags.
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-[12px] font-medium">How it unfurls</p>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="flex aspect-[1.91/1] items-center justify-center overflow-hidden bg-secondary">
                    {draft.previewImage && isUrl(draft.previewImage) ? (
                      <img src={draft.previewImage} alt="" className="size-full object-cover" />
                    ) : (
                      <ImageIcon className="size-8 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {draft.domain || "your domain"}
                    </p>
                    <p className="truncate text-[13px] font-semibold">
                      {draft.previewTitle || draft.title || "Title from the destination page"}
                    </p>
                    <p className="line-clamp-2 text-[12px] text-muted-foreground">
                      {draft.previewDescription || "Description from the destination page."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "advanced" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Expires at"
                  htmlFor="link-expires"
                  hint="Local time. After it, visitors go to the expired URL (or a 410 page)."
                >
                  <TextInput
                    id="link-expires"
                    type="datetime-local"
                    value={draft.expiresAt}
                    onChange={(e) => set("expiresAt", e.target.value)}
                  />
                </Field>
                <Field label="Expired URL" htmlFor="link-expired-url">
                  <TextInput
                    id="link-expired-url"
                    placeholder="https://acme.com/sale-ended"
                    value={draft.expiredUrl}
                    onChange={(e) => set("expiredUrl", e.target.value)}
                  />
                </Field>
                <Field
                  label="Max clicks"
                  htmlFor="link-max-clicks"
                  hint="Expire after this many human clicks."
                >
                  <TextInput
                    id="link-max-clicks"
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={draft.maxClicks}
                    onChange={(e) => set("maxClicks", e.target.value)}
                  />
                </Field>
                <Field label="Redirect status">
                  <Dropdown
                    aria-label="Redirect status"
                    value={draft.redirectStatus}
                    onValueChange={(v) => set("redirectStatus", v as LinkDraft["redirectStatus"])}
                    options={[
                      {
                        value: "302",
                        label: "302 Found",
                        description: "Temporary (default) — every click is counted",
                      },
                      {
                        value: "301",
                        label: "301 Moved Permanently",
                        description: "Browsers may cache it and skip analytics",
                      },
                      {
                        value: "307",
                        label: "307 Temporary Redirect",
                        description: "Keeps the request method",
                      },
                      {
                        value: "308",
                        label: "308 Permanent Redirect",
                        description: "Permanent, keeps the method",
                      },
                    ]}
                    className="w-full"
                  />
                </Field>
              </div>

              <div className="rounded-xl border border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium">
                    <KeyRound className="size-3.5 text-muted-foreground" /> Password
                  </p>
                  <Segmented
                    size="sm"
                    value={draft.passwordMode}
                    onValueChange={(v) => set("passwordMode", v)}
                    options={
                      link?.hasPassword
                        ? [
                            { value: "keep", label: "Keep" },
                            { value: "set", label: "Change" },
                            { value: "remove", label: "Remove" },
                          ]
                        : [
                            { value: "none", label: "None" },
                            { value: "set", label: "Protect" },
                          ]
                    }
                  />
                </div>
                {draft.passwordMode === "set" && (
                  <Field
                    label="New password"
                    htmlFor="link-password"
                    error={attempted ? passwordError : null}
                    className="mt-3"
                  >
                    <TextInput
                      id="link-password"
                      type="password"
                      autoComplete="new-password"
                      value={draft.password}
                      onChange={(e) => set("password", e.target.value)}
                    />
                  </Field>
                )}
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  Visitors enter it before being redirected. Stored as a PBKDF2 hash, never shown
                  again.
                </p>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border px-4">
                <ToggleRow
                  label="Track conversions"
                  hint="Append the click id to the destination so leads and sales attribute back to this link."
                  checked={draft.trackConversions}
                  onChange={(v) => set("trackConversions", v)}
                />
                <ToggleRow
                  label="Forward query string"
                  hint="Pass ?params on the short URL through to the destination."
                  checked={draft.passQuery}
                  onChange={(v) => set("passQuery", v)}
                />
                <ToggleRow
                  label="Indexable"
                  hint="Let search engines index the short URL (sends no X-Robots-Tag: noindex)."
                  checked={draft.indexable}
                  onChange={(v) => set("indexable", v)}
                />
                <ToggleRow
                  label="Disabled"
                  hint="Stop redirecting without deleting the link."
                  checked={draft.disabled}
                  onChange={(v) => set("disabled", v)}
                />
                {editing && can("link:update") && (
                  <ToggleRow
                    label="Archived"
                    hint="Hide from the default list; the link keeps redirecting."
                    checked={draft.archived}
                    onChange={(v) => set("archived", v)}
                  />
                )}
              </div>

              <Field
                label="External id"
                htmlFor="link-external-id"
                hint="Your own id for idempotent upserts (unique per tenant)."
              >
                <TextInput
                  id="link-external-id"
                  className="font-mono"
                  placeholder="campaign-2026-spring"
                  value={draft.externalId}
                  onChange={(e) => set("externalId", e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      </Drawer>
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        title="Discard changes?"
        confirmLabel="Discard"
        danger
      >
        <p className="text-[13px] text-muted-foreground">
          {editing
            ? `Your edits to ${displayUrl(shortUrl(link!))} will be lost.`
            : "This link has not been created yet."}
        </p>
      </ConfirmDialog>
    </>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span
      className={cn(
        "ml-1 rounded bg-accent/20 px-1 text-[10px] font-semibold tabular-nums text-foreground",
      )}
    >
      {n}
    </span>
  );
}
