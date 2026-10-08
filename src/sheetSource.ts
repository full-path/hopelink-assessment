import { normalizeDataset, type Dataset, type SourceTexts } from "./data/dataset";

/**
 * Reads the live dataset from a published Google Sheet — the one network read of intake data
 * the app makes, and the source staff edit day to day.
 *
 * Each of the sheet's four tabs is published to the web as CSV (File → Share → Publish to web)
 * and its URL supplied at build time; see README "Live data from a Google Sheet". The texts are
 * normalized by `normalizeDataset`, the same function the build runs on `/data`, so the sheet is
 * held to the same strictness as a build: an unknown agency, a missing column or a duplicate
 * question rejects the whole sheet rather than displaying part of it.
 *
 * This module only fetches and validates. Whether and when the result replaces what is on screen
 * is `main.ts`'s decision, because that depends on what the reader is doing.
 */

/** How long to wait for all four tabs before giving up and keeping the snapshot. */
export const SHEET_TIMEOUT_MS = 15_000;

/** The env var holding each tab's published-CSV URL. */
export const SHEET_URL_VARS = {
  agencies: "VITE_SHEET_AGENCIES_CSV_URL",
  questions: "VITE_SHEET_QUESTIONS_CSV_URL",
  capabilities: "VITE_SHEET_CAPABILITIES_CSV_URL",
  capabilityMap: "VITE_SHEET_CAPABILITY_MAP_CSV_URL",
} as const satisfies Record<keyof SourceTexts, string>;

/** Human names for error messages, matching the tab names the README tells staff to use. */
const TAB_NAMES: Record<keyof SourceTexts, string> = {
  agencies: "Agencies",
  questions: "Questions",
  capabilities: "Capabilities",
  capabilityMap: "Question-capability map",
};

export type SheetUrls = Record<keyof SourceTexts, string>;

export type SheetConfig =
  | { status: "disabled" }
  | { status: "misconfigured"; message: string }
  | { status: "enabled"; urls: SheetUrls };

/**
 * Reads the four URLs from build-time env. None set is a supported build (snapshot only, as
 * before). Some-but-not-all is a mistake worth saying out loud rather than half-honouring: the
 * tabs depend on one another — every tab resolves agency names against the Agencies tab — so
 * mixing live tabs with snapshot ones could pair a sheet edit with a roster that predates it.
 */
export function readSheetConfig(env: Partial<Record<string, string>>): SheetConfig {
  const entries = Object.entries(SHEET_URL_VARS) as [keyof SourceTexts, string][];
  const values = entries.map(([role, name]) => [role, env[name]?.trim() ?? ""] as const);
  const missing = entries.filter((_, i) => !values[i]?.[1]).map(([, name]) => name);

  if (missing.length === entries.length) return { status: "disabled" };
  if (missing.length > 0) {
    return {
      status: "misconfigured",
      message: `The live sheet is only partly configured; missing ${missing.join(", ")}.`,
    };
  }
  return { status: "enabled", urls: Object.fromEntries(values) as SheetUrls };
}

/**
 * Fetches one tab. `cache: "no-cache"` makes the browser revalidate rather than serve its own
 * copy — it is not a request header, so the request stays CORS-simple. Google still caches
 * published output for a few minutes on its side; nothing here can shorten that.
 */
async function fetchTab(role: keyof SourceTexts, url: string, signal: AbortSignal) {
  const tab = TAB_NAMES[role];
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

/** Fetches all four tabs in parallel, as raw CSV text. Used directly by `scripts/pull-sheet.ts`. */
export async function fetchSheetTexts(urls: SheetUrls): Promise<SourceTexts> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SHEET_TIMEOUT_MS);

  try {
    const [agencies, questions, capabilities, capabilityMap] = await Promise.all([
      fetchTab("agencies", urls.agencies, controller.signal),
      fetchTab("questions", urls.questions, controller.signal),
      fetchTab("capabilities", urls.capabilities, controller.signal),
      fetchTab("capabilityMap", urls.capabilityMap, controller.signal),
    ]);
    return { agencies, questions, capabilities, capabilityMap };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches all four tabs and normalizes them as one dataset, or throws. */
export async function loadSheetDataset(urls: SheetUrls): Promise<Dataset> {
  return normalizeDataset(await fetchSheetTexts(urls));
}
