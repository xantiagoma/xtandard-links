/**
 * Bot and link-preview detection from the user agent (ADR 0007). A built-in,
 * zero-dependency pattern list in the spirit of `isbot`: crawlers, link-preview
 * unfurlers, uptime monitors, headless browsers and HTTP libraries.
 *
 * @module
 */

/** Unfurlers that fetch a link to render a preview card (they get OG pages). */
const PREVIEW_PATTERNS = [
  "facebookexternalhit",
  "facebookcatalog",
  "meta-externalagent",
  "twitterbot",
  "slackbot",
  "slack-imgproxy",
  "linkedinbot",
  "discordbot",
  "whatsapp",
  "telegrambot",
  "skypeuripreview",
  "microsoftpreview",
  "pinterestbot",
  "redditbot",
  "embedly",
  "iframely",
  "vkshare",
  "mastodon",
  "bluesky",
  "cardyb",
  "applebot",
  "google-pagerenderer",
  "snapchat",
  "line-poker",
  "kakaotalk-scrap",
  "viber",
  "mattermost",
];

/** Generic automation markers. Matched as substrings, case-insensitively. */
const BOT_PATTERNS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "scrap",
  "preview",
  "fetch",
  "monitor",
  "uptime",
  "pingdom",
  "statuscake",
  "headless",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
  "lighthouse",
  "pagespeed",
  "gtmetrix",
  "curl/",
  "wget/",
  "httpie",
  "python-requests",
  "python-urllib",
  "aiohttp",
  "httpx",
  "go-http-client",
  "java/",
  "okhttp",
  "apache-httpclient",
  "node-fetch",
  "undici",
  "axios/",
  "got (",
  "libwww-perl",
  "ruby",
  "php/",
  "guzzlehttp",
  "postmanruntime",
  "insomnia",
  "dart:io",
  "feed",
  "rss",
  "archive.org",
  "ia_archiver",
  "google-read-aloud",
  "googleother",
  "google-inspectiontool",
  "mediapartners-google",
  "adsbot",
  "bingpreview",
  "yandex",
  "baiduspider",
  "duckduckgo",
  "petalbot",
  "semrush",
  "ahrefs",
  "mj12bot",
  "dotbot",
  "dataforseo",
  "gptbot",
  "chatgpt-user",
  "oai-searchbot",
  "claudebot",
  "claude-web",
  "anthropic-ai",
  "perplexity",
  "ccbot",
  "bytespider",
  "amazonbot",
  "cohere-ai",
  "diffbot",
  "scanner",
  "nuclei",
  "zgrab",
  "masscan",
  "nmap",
  "check_http",
  "cloudflare-",
  "vercel-",
  "prerender",
];

const PREVIEW_RE = new RegExp(PREVIEW_PATTERNS.map(escape).join("|"), "i");
const BOT_RE = new RegExp(BOT_PATTERNS.map(escape).join("|"), "i");

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the user agent belongs to a link-preview unfurler (Slack, X, iMessage, …). */
export function isPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return PREVIEW_RE.test(userAgent);
}

/**
 * True when the user agent looks automated: crawlers, unfurlers, monitors,
 * headless browsers, HTTP libraries — or is missing entirely.
 */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 5) return true;
  if (PREVIEW_RE.test(userAgent)) return true;
  // Real browsers always announce Mozilla/…; this is a cheap pre-filter.
  if (BOT_RE.test(userAgent)) {
    // "Teams" and similar desktop apps embed Mozilla and are real users when
    // they don't advertise preview behaviour — handled by PREVIEW_RE above.
    return true;
  }
  return !/mozilla\/|opera\/|dalvik\//i.test(userAgent);
}
