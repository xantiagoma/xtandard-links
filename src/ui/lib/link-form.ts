/**
 * The link editor's form model: a flat, string-friendly draft that maps to and
 * from the API's `CreateLinkInput` / `UpdateLinkInput`. Updates send only the
 * fields that changed, with `null` for cleared ones (the API's "clear" signal).
 * Pure — unit-tested in `test/ui-lib.test.ts`.
 *
 * @module
 */

import type { CreateLinkInput, UpdateLinkInput } from "../../core.ts";
import type { LinkRule, RedirectStatus, Utm } from "../../schema.ts";
import type { PublicLink } from "../types.ts";
import { generateSlug, slugProblem } from "../../slug.ts";
import { rulesToInput } from "./rules.ts";

export const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export type PasswordMode = "none" | "keep" | "set" | "remove";

export interface LinkDraft {
  url: string;
  domain: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  externalId: string;
  utm: Record<UtmKey, string>;
  /** `datetime-local` value (local time), or `""`. */
  expiresAt: string;
  expiredUrl: string;
  maxClicks: string;
  /** `keep` an existing password, `set` a new one, `remove` it, or `none`. */
  passwordMode: PasswordMode;
  password: string;
  previewTitle: string;
  previewDescription: string;
  previewImage: string;
  ios: string;
  android: string;
  deepLinkPath: string;
  deepLinkDeferred: boolean;
  redirectStatus: `${RedirectStatus}`;
  trackConversions: boolean;
  passQuery: boolean;
  indexable: boolean;
  disabled: boolean;
  archived: boolean;
  rules: LinkRule[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → `datetime-local` value in the browser's zone (`""` for none/invalid). */
export function toLocalInput(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value → ISO (`null` for empty/invalid). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const emptyUtm = (): Record<UtmKey, string> => ({
  source: "",
  medium: "",
  campaign: "",
  term: "",
  content: "",
});

/** A draft for a new link (or an existing one when `link` is given). */
export function draftFromLink(
  link?: PublicLink | null,
  defaults: { domain?: string } = {},
): LinkDraft {
  const utm = emptyUtm();
  for (const k of UTM_KEYS) utm[k] = link?.utm?.[k] ?? "";
  return {
    url: link?.url ?? "",
    domain: link?.domain ?? defaults.domain ?? "",
    slug: link?.slug ?? "",
    title: link?.title ?? "",
    description: link?.description ?? "",
    tags: [...(link?.tags ?? [])],
    externalId: link?.externalId ?? "",
    utm,
    expiresAt: toLocalInput(link?.expiresAt),
    expiredUrl: link?.expiredUrl ?? "",
    maxClicks: link?.maxClicks !== undefined ? String(link.maxClicks) : "",
    passwordMode: link?.hasPassword ? "keep" : "none",
    password: "",
    previewTitle: link?.preview?.title ?? "",
    previewDescription: link?.preview?.description ?? "",
    previewImage: link?.preview?.image ?? "",
    ios: link?.ios ?? "",
    android: link?.android ?? "",
    deepLinkPath: link?.deepLink?.path ?? "",
    deepLinkDeferred: link?.deepLink?.deferred ?? false,
    redirectStatus: String(link?.redirectStatus ?? 302) as LinkDraft["redirectStatus"],
    trackConversions: link?.trackConversions ?? false,
    passQuery: link?.passQuery ?? true,
    indexable: link?.indexable ?? false,
    disabled: link?.disabled ?? false,
    archived: link?.archived ?? false,
    rules: structuredClone(link?.rules ?? []),
  };
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

function utmOf(draft: LinkDraft): Utm | null {
  const utm: Utm = {};
  for (const k of UTM_KEYS) if (draft.utm[k].trim()) utm[k] = draft.utm[k].trim();
  return Object.keys(utm).length ? utm : null;
}

/** Every field of the draft as API input, `null` meaning "not set". */
function fields(draft: LinkDraft): Record<string, unknown> {
  const maxClicks = draft.maxClicks.trim() ? Number(draft.maxClicks) : null;
  const preview: Record<string, string> = {};
  if (draft.previewTitle.trim()) preview.title = draft.previewTitle.trim();
  if (draft.previewDescription.trim()) preview.description = draft.previewDescription.trim();
  if (draft.previewImage.trim()) preview.image = draft.previewImage.trim();
  const deepLink =
    draft.deepLinkPath.trim() || draft.deepLinkDeferred
      ? {
          ...(draft.deepLinkPath.trim() ? { path: draft.deepLinkPath.trim() } : {}),
          ...(draft.deepLinkDeferred ? { deferred: true } : {}),
        }
      : null;
  return {
    url: draft.url.trim(),
    domain: draft.domain || null,
    slug: draft.slug.trim() || null,
    title: orNull(draft.title),
    description: orNull(draft.description),
    tags: draft.tags,
    externalId: orNull(draft.externalId),
    utm: utmOf(draft),
    expiresAt: fromLocalInput(draft.expiresAt),
    expiredUrl: orNull(draft.expiredUrl),
    maxClicks: Number.isFinite(maxClicks) ? maxClicks : null,
    preview: Object.keys(preview).length ? preview : null,
    ios: orNull(draft.ios),
    android: orNull(draft.android),
    deepLink,
    redirectStatus: Number(draft.redirectStatus) as RedirectStatus,
    trackConversions: draft.trackConversions,
    passQuery: draft.passQuery,
    indexable: draft.indexable,
    disabled: draft.disabled,
    archived: draft.archived,
    rules: rulesToInput(draft.rules),
  };
}

/** Input for `POST …/links`: unset fields omitted (defaults apply server-side). */
export function draftToCreateInput(draft: LinkDraft): CreateLinkInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields(draft))) {
    if (v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  // Server defaults (302, passQuery on, flags off) need not be sent.
  if (out.redirectStatus === 302) delete out.redirectStatus;
  for (const k of ["trackConversions", "indexable", "disabled", "archived"]) {
    if (out[k] === false) delete out[k];
  }
  if (out.passQuery === true) delete out.passQuery;
  if (draft.passwordMode === "set" && draft.password) out.password = draft.password;
  return out as unknown as CreateLinkInput;
}

/** Input for `PATCH …/links/:id`: only what changed vs `original`, `null` clears. */
export function draftToPatch(draft: LinkDraft, original: PublicLink): UpdateLinkInput {
  const next = fields(draft);
  const prev = fields(draftFromLink(original));
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(v) !== JSON.stringify(prev[k])) patch[k] = v;
  }
  // Slug and domain are required on the link — never send null for them.
  if (patch.slug === null) delete patch.slug;
  if (patch.domain === null) delete patch.domain;
  if (draft.passwordMode === "set" && draft.password) patch.password = draft.password;
  if (draft.passwordMode === "remove") patch.password = null;
  return patch as UpdateLinkInput;
}

/** True when the draft differs from `original` (or from an empty draft). */
export function isDirty(draft: LinkDraft, original?: PublicLink | null): boolean {
  if (original) return Object.keys(draftToPatch(draft, original)).length > 0;
  return draft.url.trim() !== "" || draft.slug.trim() !== "" || draft.title.trim() !== "";
}

/** The destination with the draft's UTM parameters merged in (existing params win). */
export function applyUtm(url: string, utm: Partial<Record<UtmKey, string>>): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  for (const k of UTM_KEYS) {
    const v = utm[k]?.trim();
    if (v && !u.searchParams.has(`utm_${k}`)) u.searchParams.set(`utm_${k}`, v);
  }
  return u.toString();
}

/**
 * Pull `utm_*` parameters out of a pasted destination so they land in the UTM
 * builder instead of the URL. Returns `null` when there are none.
 */
export function extractUtm(
  url: string,
): { url: string; utm: Partial<Record<UtmKey, string>> } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const utm: Partial<Record<UtmKey, string>> = {};
  for (const k of UTM_KEYS) {
    const v = u.searchParams.get(`utm_${k}`);
    if (v) {
      utm[k] = v;
      u.searchParams.delete(`utm_${k}`);
    }
  }
  if (!Object.keys(utm).length) return null;
  return { url: u.toString(), utm };
}

/** Why a slug is invalid (the package's own check, ADR 0012), or `null`. Empty = generated. */
export function slugIssue(slug: string): string | null {
  return slug ? slugProblem(slug) : null;
}

export { generateSlug };
