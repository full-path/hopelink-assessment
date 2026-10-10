import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCE_FILES, SOURCE_ROLES } from "./data/dataset";
import {
  loadSheetDataset,
  readSheetConfig,
  SHEET_TIMEOUT_MS,
  type SheetTabs,
  type SheetUrls,
} from "./sheetSource";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");

const URLS = Object.fromEntries(
  SOURCE_ROLES.map((role) => [role, `https://sheet.test/${role}`]),
) as SheetUrls;

/** The committed CSVs, served as if they were the published tabs. */
const TABS: Record<string, string> = Object.fromEntries(
  SOURCE_ROLES.map((role) => [URLS[role], read(`../data/${SOURCE_FILES[role]}`)]),
);

function serveTabs(overrides: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn((url: string) => {
    const override = overrides[url];
    if (override) return Promise.resolve(override());
    const body = TABS[url];
    return Promise.resolve(
      body === undefined
        ? new Response("", { status: 404 })
        : new Response(body, { status: 200, headers: { "content-type": "text/csv" } }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("readSheetConfig", () => {
  const PUBLISHED = "https://docs.google.com/spreadsheets/d/e/2PACX-abc123/pub";
  const wired = Object.fromEntries(
    SOURCE_ROLES.map((role, i) => [role, { name: role, gid: i * 100 }]),
  ) as SheetTabs;

  it("is disabled when no published URL is set — the snapshot-only build", () => {
    expect(readSheetConfig({}, wired)).toEqual({ status: "disabled" });
    expect(readSheetConfig({ VITE_SHEET_PUBLISHED_URL: "  " }, wired)).toEqual({
      status: "disabled",
    });
  });

  it("builds one CSV URL per tab from the published URL and the gids", () => {
    const config = readSheetConfig({ VITE_SHEET_PUBLISHED_URL: PUBLISHED }, wired);
    expect(config.status === "enabled" && config.urls.requirements).toBe(
      `${PUBLISHED}?gid=${String(wired.requirements.gid)}&single=true&output=csv`,
    );
  });

  it("accepts the link however it was copied: as /pubhtml, or with a query string", () => {
    for (const copied of [
      `${PUBLISHED}html`,
      `${PUBLISHED}?output=csv`,
      `${PUBLISHED}html#gid=0`,
    ]) {
      const config = readSheetConfig({ VITE_SHEET_PUBLISHED_URL: copied }, wired);
      expect(config.status === "enabled" && config.urls.agencies).toBe(
        `${PUBLISHED}?gid=0&single=true&output=csv`,
      );
    }
  });

  it("rejects a link that is not a published one, such as the editing URL", () => {
    const config = readSheetConfig(
      { VITE_SHEET_PUBLISHED_URL: "https://docs.google.com/spreadsheets/d/abc123/edit" },
      wired,
    );
    expect(config.status === "misconfigured" && config.message).toMatch(/ending in \/pub/);
  });

  it("names the tabs with no gid rather than mixing live and snapshot tabs", () => {
    const partial = { ...wired, questionLinks: { name: "Question links", gid: null } };
    const config = readSheetConfig({ VITE_SHEET_PUBLISHED_URL: PUBLISHED }, partial);
    expect(config.status === "misconfigured" && config.message).toMatch(
      /no gid for Question links in src\/sheetTabs.ts/,
    );
  });
});

describe("loadSheetDataset", () => {
  it("fetches every tab and normalizes them as one dataset", async () => {
    const fetchMock = serveTabs();
    const dataset = await loadSheetDataset(URLS);

    expect(fetchMock).toHaveBeenCalledTimes(SOURCE_ROLES.length);
    expect(dataset.data).toEqual(JSON.parse(read("./data/questions.json")));
    expect(dataset.capabilities).toEqual(JSON.parse(read("./data/capabilities.json")));
  });

  it("keeps each request CORS-simple: a GET with no custom headers", async () => {
    // Google's published-CSV endpoint is fetched cross-origin; a preflight would fail.
    const fetchMock = serveTabs();
    await loadSheetDataset(URLS);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.method).toBe("GET");
      expect(init.headers).toBeUndefined();
    }
  });

  it("uses the sheet's own roster, so an agency added there resolves", async () => {
    const roster = `${TABS[URLS.agencies] ?? ""}New Agency,Ride provider,,,\n`;
    const questions = `${TABS[URLS.questions] ?? ""}a-new-question,A new question,\n`;
    const requirements = `${TABS[URLS.requirements] ?? ""}a-new-question,New Agency,Required,,\n`;
    serveTabs({
      [URLS.agencies]: () => new Response(roster),
      [URLS.questions]: () => new Response(questions),
      [URLS.requirements]: () => new Response(requirements),
    });

    const dataset = await loadSheetDataset(URLS);
    expect(dataset.data.questions.at(-1)?.requirements).toEqual([
      { agencyId: "new-agency", level: "required" },
    ]);
  });

  it("rejects the whole sheet when one tab fails validation", async () => {
    const requirements = `${TABS[URLS.requirements] ?? ""}phone,Unlisted Agency,Required,,\n`;
    serveTabs({ [URLS.requirements]: () => new Response(requirements) });
    await expect(loadSheetDataset(URLS)).rejects.toThrow(
      /Unrecognized agency name "Unlisted Agency"/,
    );
  });

  it("explains a web page served in place of CSV — the unpublished-tab failure", async () => {
    serveTabs({
      [URLS.capabilities]: () =>
        new Response("<!DOCTYPE html><html>Sign in</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });
    await expect(loadSheetDataset(URLS)).rejects.toThrow(
      /Capabilities tab returned a web page instead of CSV/,
    );
  });

  it("names the tab on an HTTP error", async () => {
    serveTabs({ [URLS.agencies]: () => new Response("", { status: 404 }) });
    await expect(loadSheetDataset(URLS)).rejects.toThrow(/Agencies tab returned HTTP 404/);
  });

  it("names the tab on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(loadSheetDataset(URLS)).rejects.toThrow(
      /Could not reach the .* tab \(Failed to fetch\)/,
    );
  });

  it("gives up after the timeout instead of hanging", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    const pending = expect(loadSheetDataset(URLS)).rejects.toThrow(/did not respond within/);
    await vi.advanceTimersByTimeAsync(SHEET_TIMEOUT_MS);
    await pending;
  });
});
