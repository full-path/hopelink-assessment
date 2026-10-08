import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeDataset } from "./dataset";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");

describe("normalizeDataset", () => {
  it("reproduces the committed JSON from the committed CSVs", () => {
    // The JSON is the snapshot the page paints first. If a CSV in /data is edited without
    // re-running build-data, the page would open on data that matches neither /data nor the
    // sheet, and then visibly swap — this catches that before it ships.
    const dataset = normalizeDataset({
      agencies: read("../../data/agencies.csv"),
      questions: read("../../data/eligibility-questions.csv"),
      capabilities: read("../../data/capabilities.csv"),
      capabilityMap: read("../../data/question-capability-map.csv"),
    });

    expect(dataset.data).toEqual(JSON.parse(read("./questions.json")));
    expect(dataset.capabilities).toEqual(JSON.parse(read("./capabilities.json")));
  });
});
