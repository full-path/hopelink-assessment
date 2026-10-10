import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeDataset, SOURCE_FILES, SOURCE_ROLES, type SourceTexts } from "./dataset";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");

describe("normalizeDataset", () => {
  it("reproduces the committed JSON from the committed CSVs", () => {
    // The JSON is the snapshot the page paints first. If a CSV in /data is edited (or pulled
    // from the sheet) without re-running build-data, the page would open on data that matches
    // neither /data nor the sheet, and then visibly swap — this catches that before it ships.
    const sources = Object.fromEntries(
      SOURCE_ROLES.map((role) => [role, read(`../../data/${SOURCE_FILES[role]}`)]),
    ) as Record<keyof SourceTexts, string>;
    const dataset = normalizeDataset(sources);

    expect(dataset.data).toEqual(JSON.parse(read("./questions.json")));
    expect(dataset.capabilities).toEqual(JSON.parse(read("./capabilities.json")));
  });
});
