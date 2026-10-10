import { normalizeDataset, SOURCE_ROLES, type Dataset, type SourceTexts } from "./data/dataset";
import { SHEET_TABS } from "./sheetTabs";

/**
 * Reads the live dataset from a published Google Sheet — the one network read of intake data
 * the app makes, and the source staff edit day to day.
 *
 * The sheet's data tabs are published to the web as CSV (File → Share → Publish to web); the
 * document's published URL is supplied at build time and the tabs are identified in
 * `src/sheetTabs.ts`. See README "Live data from a Google Sheet". The texts are
 * normalized by `normalizeDataset`, the same function the build runs on `/data`, so the sheet is
 * held to the same strictness as a build: an unknown agency, a missing column or a duplicate
 * question rejects the whole sheet rather than displaying part of it.
 *
 * This module only fetches and validates. Whether and when the result replaces what is on screen
 * is `main.ts`'s decision, because that depends on what the reader is doing.
 */

/** How long to wait for every tab before giving up and keeping the snapshot. */
export const SHEET_TIMEOUT_MS = 15_000;

export type TabRole = keyof SourceTexts;
export type SheetTabs = Record<TabRole, { name: string; gid: number | null }>;
export type SheetUrls = Record<TabRole, string>;

export type SheetConfig =
  | { status: "disabled" }
  | { status: "misconfigured"; message: string }
  | { status: "enabled"; urls: SheetUrls };

/**
 * Builds each tab's CSV URL from the published document's address (`VITE_SHEET_PUBLISHED_URL`,
 * the `…/pub` link from File → Share → Publish to web) and the gids in `src/sheetTabs.ts`.
 *
 * No URL is a supported build (snapshot only). A URL with any tab un-wired is a mistake worth
 * saying out loud rather than half-honouring: the tabs depend on one another — every tab resolves
 * agency names against the Agencies tab — so mixing live tabs with snapshot ones could pair a
 * sheet edit with a roster that predates it.
 */
export function readSheetConfig(
  env: Partial<Record<string, string>>,
  tabs: SheetTabs = SHEET_TABS,
): SheetConfig {
  const published = env.VITE_SHEET_PUBLISHED_URL?.trim() ?? "";
  if (!published) return { status: "disabled" };

  // Accept the link however it was copied: with or without its query string or a trailing
  // "/pubhtml" (the HTML view Google offers by default).
  const base = published.split(/[?#]/)[0]?.replace(/\/pubhtml$/, "/pub") ?? "";
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^/]+\/pub$/.test(base)) {
    return {
      status: "misconfigured",
      message:
        `VITE_SHEET_PUBLISHED_URL should be the "Publish to web" link, ending in /pub; ` +
        `got "${published}".`,
    };
  }

  const roles = SOURCE_ROLES;
  const unwired = roles.filter((role) => tabs[role].gid === null).map((role) => tabs[role].name);
  if (unwired.length > 0) {
    return {
      status: "misconfigured",
      message: `The live sheet is only partly configured; no gid for ${unwired.join(", ")} in src/sheetTabs.ts.`,
    };
  }

  const urls = Object.fromEntries(
    roles.map((role) => [role, `${base}?gid=${String(tabs[role].gid)}&single=true&output=csv`]),
  ) as SheetUrls;
  return { status: "enabled", urls };
}

/**
 * Fetches one tab. `cache: "no-cache"` makes the browser revalidate rather than serve its own
 * copy — it is not a request header, so the request stays CORS-simple. Google still caches
 * published output for a few minutes on its side; nothing here can shorten that.
 */
async function fetchTab(role: TabRole, url: string, signal: AbortSignal) {
  const tab = SHEET_TABS[role].name;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", cache: "no-cache", signal });
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`The sheet did not respond within ${String(SHEET_TIMEOUT_MS / 1000)}s.`);
    }
    throw new Error(
      `Could not reach the ${tab} tab (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok) {
    throw new Error(`The ${tab} tab returned HTTP ${String(response.status)}.`);
  }

  const text = await response.text();
  // An unpublished tab or a wrong URL tends to come back as a Google web page with status 200,
  // which would otherwise surface as a baffling "missing column" error from the parser.
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html") || /^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(
      `The ${tab} tab returned a web page instead of CSV. Check that it is published to the ` +
        `web as CSV and that its URL is the published one.`,
    );
  }
  return text;
}

/** Fetches every tab in parallel, as raw CSV text. Used directly by `scripts/pull-sheet.ts`. */
export async function fetchSheetTexts(urls: SheetUrls): Promise<SourceTexts> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SHEET_TIMEOUT_MS);

  try {
    const texts = await Promise.all(
      SOURCE_ROLES.map((role) => fetchTab(role, urls[role], controller.signal)),
    );
    return Object.fromEntries(SOURCE_ROLES.map((role, i) => [role, texts[i] ?? ""])) as Record<
      TabRole,
      string
    >;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches every tab and normalizes them as one dataset, or throws. */
export async function loadSheetDataset(urls: SheetUrls): Promise<Dataset> {
  return normalizeDataset(await fetchSheetTexts(urls));
}
