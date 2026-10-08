import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSheetDataset, readSheetConfig, SHEET_TIMEOUT_MS, type SheetUrls } from "./sheetSource";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");

const URLS: SheetUrls = {
  agencies: "https://sheet.test/agencies",
  questions: "https://sheet.test/questions",
  capabilities: "https://sheet.test/capabilities",
  capabilityMap: "https://sheet.test/map",
};

/** The committed CSVs, served as if they were the published tabs. */
const TABS: Record<string, string> = {
  [URLS.agencies]: read("../data/agencies.csv"),
  [URLS.questions]: read("../data/eligibility-questions.csv"),
  [URLS.capabilities]: read("../data/capabilities.csv"),
  [URLS.capabilityMap]: read("../data/question-capability-map.csv"),
};

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
  const all = {
    VITE_SHEET_AGENCIES_CSV_URL: URLS.agencies,
    VITE_SHEET_QUESTIONS_CSV_URL: URLS.questions,
    VITE_SHEET_CAPABILITIES_CSV_URL: URLS.capabilities,
    VITE_SHEET_CAPABILITY_MAP_CSV_URL: URLS.capabilityMap,
  };

  it("is disabled when no URL is set — the snapshot-only build", () => {
    expect(readSheetConfig({})).toEqual({ status: "disabled" });
    expect(readSheetConfig({ VITE_SHEET_AGENCIES_CSV_URL: "  " })).toEqual({ status: "disabled" });
  });

  it("is enabled with all four URLs", () => {
    expect(readSheetConfig(all)).toEqual({ status: "enabled", urls: URLS });
  });

  it("names what is missing when only some URLs are set, rather than mixing sources", () => {
    const config = readSheetConfig({ ...all, VITE_SHEET_CAPABILITY_MAP_CSV_URL: "" });
    expect(config.status).toBe("misconfigured");
    expect(config.status === "misconfigured" && config.message).toMatch(
      /missing VITE_SHEET_CAPABILITY_MAP_CSV_URL/,
    );
  });
});

describe("loadSheetDataset", () => {
  it("fetches all four tabs and normalizes them as one dataset", async () => {
    const fetchMock = serveTabs();
    const dataset = await loadSheetDataset(URLS);

    expect(fetchMock).toHaveBeenCalledTimes(4);
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
    const roster = `${TABS[URLS.agencies] ?? ""}New Agency,Ride provider,,\n`;
    const questions = `${TABS[URLS.questions] ?? ""}A new question,New Agency,,,,,,\n`;
    serveTabs({
      [URLS.agencies]: () => new Response(roster),
      [URLS.questions]: () => new Response(questions),
    });

    const dataset = await loadSheetDataset(URLS);
    expect(dataset.data.questions.at(-1)?.requirements).toEqual([
      { agencyId: "new-agency", level: "required" },
    ]);
  });

  it("rejects the whole sheet when one tab fails validation", async () => {
    const questions = `${TABS[URLS.questions] ?? ""}A new question,Unlisted Agency,,,,,,\n`;
    serveTabs({ [URLS.questions]: () => new Response(questions) });
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
