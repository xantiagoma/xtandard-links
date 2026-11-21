# ADR 0012 — Slugs: Normalization, Generation, Reserved Words

**Status:** Accepted (★ new)

---

## Decision

- Slugs are matched **case-insensitively by default** (`Domain.caseSensitive` opts out): the key is
  the slug lowercased + NFC-normalized; the slug as written is preserved for display. This avoids
  `/Sale` vs `/sale` support tickets and makes printed links forgiving.
- Allowed characters: Unicode letters/digits, `-`, `_`, `.`, `~`, and `/` (nested slugs like
  `docs/intro`); 1–190 chars; no leading/trailing `/`, no `..`.
- Generated slugs: 7 chars from `[a-z0-9]` minus look-alikes (`0 o 1 l i`), via Web Crypto; retried
  on collision (up to 5, then length + 1). Domain `slugLength` overrides.
- Reserved per redirect handler: `.well-known/*`, `api`, `_links`, `favicon.ico`, `robots.txt`
  (configurable `reservedSlugs`). The bare domain root (`/`) goes to `Domain.rootUrl` or falls
  through.

## Consequences

- Case-sensitive installs (`Domain.caseSensitive: true`) get a larger generated alphabet.
