import { describe, expect, it } from "vitest";
import {
  normalizeCapabilitiesCsv,
  parseCapabilityValue,
  resolveQuestionCapabilityLinks,
} from "./normalizeCapabilities";
import type { IntakeQuestion } from "./types";

const MATRIX_HEADER = "Agency Name,Wheelchair Accessible,Interpretation Support";
const MAP_HEADER = "Question,Capability,Note";

function question(id: string, text: string): IntakeQuestion {
  return { id, text, requirements: [], upstreamRefs: [], downstreamRefs: [] };
}

describe("parseCapabilityValue", () => {
  it("treats a blank cell as unknown rather than as a 'no'", () => {
    expect(parseCapabilityValue("")).toEqual({ value: "unknown" });
    expect(parseCapabilityValue("   ")).toEqual({ value: "unknown" });
  });

  it("accepts yes/no in any casing", () => {
    expect(parseCapabilityValue("Yes")).toEqual({ value: "yes" });
    expect(parseCapabilityValue("yes")).toEqual({ value: "yes" });
    expect(parseCapabilityValue("No")).toEqual({ value: "no" });
    expect(parseCapabilityValue("no")).toEqual({ value: "no" });
  });

  it("keeps a parenthetical qualifier alongside a yes/no value", () => {
    expect(parseCapabilityValue("Yes (1)")).toEqual({ value: "yes", qualifier: "1" });
    expect(parseCapabilityValue("Yes (Language line)")).toEqual({
      value: "yes",
      qualifier: "Language line",
    });
  });

  it("classifies a hedged or conditional answer as conditional, preserving the wording", () => {
    expect(parseCapabilityValue("Probably yes")).toEqual({
      value: "conditional",
      qualifier: "Probably yes",
    });
    expect(parseCapabilityValue("Depends on vehicle")).toEqual({
      value: "conditional",
      qualifier: "Depends on vehicle",
    });
  });
});

describe("normalizeCapabilitiesCsv", () => {
  it("derives capabilities from the header and one profile per agency row", () => {
    const data = normalizeCapabilitiesCsv(
      [MATRIX_HEADER, "Hyde Shuttle,Yes,Yes (Language line)"].join("\n"),
      MAP_HEADER,
    );

    expect(data.capabilities).toEqual([
      { id: "wheelchair-accessible", label: "Wheelchair Accessible" },
      { id: "interpretation-support", label: "Interpretation Support" },
    ]);
    expect(data.profiles).toEqual([
      {
        agencyId: "hyde-shuttle",
        capabilities: [
          { capabilityId: "wheelchair-accessible", value: "yes" },
          { capabilityId: "interpretation-support", value: "yes", qualifier: "Language line" },
        ],
      },
    ]);
  });

  it("resolves the capability sheet's own agency spellings through the shared alias table", () => {
    const data = normalizeCapabilitiesCsv([MATRIX_HEADER, "SG VTS,Yes,"].join("\n"), MAP_HEADER);
    expect(data.profiles[0]?.agencyId).toBe("sound-generations-vts");
  });

  it("keeps an all-blank row as a profile of unknowns, distinct from having no row at all", () => {
    const data = normalizeCapabilitiesCsv([MATRIX_HEADER, "Homage TAP,,"].join("\n"), MAP_HEADER);
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0]?.capabilities.every((c) => c.value === "unknown")).toBe(true);
  });

  it("rejects a matrix whose first column is not the agency name", () => {
    expect(() => normalizeCapabilitiesCsv("Provider,Lift\nHyde Shuttle,Yes", MAP_HEADER)).toThrow(
      /must start with an "Agency Name" column/,
    );
  });

  it("rejects an unrecognized agency rather than silently dropping the row", () => {
    expect(() =>
      normalizeCapabilitiesCsv([MATRIX_HEADER, "Some New Agency,Yes,"].join("\n"), MAP_HEADER),
    ).toThrow(/Unrecognized agency name/);
  });

  it("rejects a duplicate agency row", () => {
    expect(() =>
      normalizeCapabilitiesCsv(
        [MATRIX_HEADER, "Hyde Shuttle,Yes,", "Hyde Shuttle,No,"].join("\n"),
        MAP_HEADER,
      ),
    ).toThrow(/more than one row for agency/);
  });

  it("rejects a question/capability map naming a capability that has no column", () => {
    expect(() =>
      normalizeCapabilitiesCsv(
        [MATRIX_HEADER, "Hyde Shuttle,Yes,"].join("\n"),
        [MAP_HEADER, "Accessibility needs,Hovercraft Accessible,"].join("\n"),
      ),
    ).toThrow(/unknown capability "Hovercraft Accessible"/);
  });

  it("carries the map's editorial note through, omitting it when blank", () => {
    const data = normalizeCapabilitiesCsv(
      [MATRIX_HEADER, "Hyde Shuttle,Yes,"].join("\n"),
      [
        MAP_HEADER,
        "Accessibility needs,Wheelchair Accessible,Editorial claim not in the source",
        "Do you need an interpreter,Interpretation Support,",
      ].join("\n"),
    );

    expect(data.questionLinks).toEqual([
      {
        questionText: "Accessibility needs",
        capabilityId: "wheelchair-accessible",
        note: "Editorial claim not in the source",
      },
      { questionText: "Do you need an interpreter", capabilityId: "interpretation-support" },
    ]);
  });
});

describe("resolveQuestionCapabilityLinks", () => {
  const links = [
    { questionText: "Accessibility needs", capabilityId: "lift" },
    { questionText: "Accessibility needs", capabilityId: "ramp" },
    { questionText: "A question that was renamed", capabilityId: "lift" },
  ];

  it("groups links by the id of the question they match", () => {
    const { byQuestionId } = resolveQuestionCapabilityLinks(links, [
      question("accessibility-needs", "Accessibility needs"),
    ]);
    expect(byQuestionId.get("accessibility-needs")).toHaveLength(2);
  });

  it("reports a link whose question is absent instead of dropping it silently", () => {
    const { unmatched } = resolveQuestionCapabilityLinks(links, [
      question("accessibility-needs", "Accessibility needs"),
    ]);
    expect(unmatched).toEqual([
      { questionText: "A question that was renamed", capabilityId: "lift" },
    ]);
  });

  it("loses every link when the question set no longer contains any of them, without throwing", () => {
    const { byQuestionId, unmatched } = resolveQuestionCapabilityLinks(links, [
      question("phone", "Phone"),
    ]);
    expect(byQuestionId.size).toBe(0);
    expect(unmatched).toHaveLength(3);
  });
});
