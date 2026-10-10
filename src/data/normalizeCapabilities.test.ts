import { describe, expect, it } from "vitest";
import { parseAgencyRoster } from "./agencies";
import {
  normalizeCapabilities,
  resolveQuestionCapabilityLinks,
  type CapabilitySourceTexts,
} from "./normalizeCapabilities";
import type { IntakeQuestion } from "./types";

/** Two surveyed providers, one never surveyed, and a fare program. */
const ROSTER = parseAgencyRoster(
  [
    "Agency,Kind,Aliases,Capability survey,Note",
    "Hyde Shuttle,Ride provider,,Returned,",
    "Sound Generations VTS,Ride provider,SG VTS,Returned,",
    "Pierce Runner,Ride provider,,,",
    "ORCA,Fare program,,,",
  ].join("\n"),
);

const CAPABILITIES = "ID,Label\nwheelchair-accessible,Wheelchair Accessible\nlift,Lift";
const ANSWERS_HEADER = "Agency,Capability ID,Answer,Agency's wording";
const MAP_HEADER = "Question ID,Capability ID,Note";

function sources(rows: Partial<{ capabilities: string; answers: string[]; map: string[] }> = {}) {
  const texts: CapabilitySourceTexts = {
    capabilities: rows.capabilities ?? CAPABILITIES,
    providerCapabilities: [ANSWERS_HEADER, ...(rows.answers ?? [])].join("\n"),
    capabilityMap: [MAP_HEADER, ...(rows.map ?? [])].join("\n"),
  };
  return normalizeCapabilities(texts, ROSTER);
}

function question(id: string): IntakeQuestion {
  return { id, text: id, requirements: [], upstreamRefs: [], downstreamRefs: [] };
}

describe("Capabilities tab", () => {
  it("takes ids and labels from the tab, so a label can be reworded without changing the id", () => {
    expect(sources({ capabilities: "ID,Label\nlift,Wheelchair lift" }).capabilities).toEqual([
      { id: "lift", label: "Wheelchair lift" },
    ]);
  });

  it("rejects a malformed or duplicate id", () => {
    expect(() => sources({ capabilities: "ID,Label\nWheelchair,Wheelchair" })).toThrow(
      /ID "Wheelchair" must be lowercase words/,
    );
    expect(() => sources({ capabilities: "ID,Label\nlift,Lift\nlift,Ramp" })).toThrow(
      /duplicate capability ID "lift"/,
    );
  });

  it("rejects a capability with no label", () => {
    expect(() => sources({ capabilities: "ID,Label\nlift," })).toThrow(/"lift" has no label/);
  });
});

describe("Provider capabilities tab", () => {
  it("builds a full profile per surveyed agency, in capability order, with unanswered cells unknown", () => {
    const { profiles } = sources({ answers: ["Hyde Shuttle,lift,Yes,"] });
    expect(profiles.find((p) => p.agencyId === "hyde-shuttle")?.capabilities).toEqual([
      { capabilityId: "wheelchair-accessible", value: "unknown" },
      { capabilityId: "lift", value: "yes" },
    ]);
  });

  it("gives a surveyed agency with no answers a profile of unknowns, and an unsurveyed one none", () => {
    // "Returned the survey blank" and "never surveyed" are different facts, and the coverage
    // view reports them differently; the roster states which, rather than leaving it inferred.
    const { profiles } = sources();
    expect(profiles.map((p) => p.agencyId)).toEqual(["hyde-shuttle", "sound-generations-vts"]);
    expect(profiles[1]?.capabilities.every((c) => c.value === "unknown")).toBe(true);
  });

  it("keeps the agency's own wording alongside the canonical answer", () => {
    const { profiles } = sources({
      answers: ["Hyde Shuttle,lift,Yes,1", "SG VTS,lift,Conditional,Depends on vehicle"],
    });
    expect(profiles.map((p) => p.capabilities[1])).toEqual([
      { capabilityId: "lift", value: "yes", qualifier: "1" },
      { capabilityId: "lift", value: "conditional", qualifier: "Depends on vehicle" },
    ]);
  });

  it("resolves agency spellings through the roster", () => {
    const { profiles } = sources({ answers: ["SG VTS,lift,No,"] });
    expect(profiles[1]?.capabilities[1]?.value).toBe("no");
  });

  it("rejects an answer outside the dropdown", () => {
    expect(() => sources({ answers: ["Hyde Shuttle,lift,Probably yes,"] })).toThrow(
      /Answer is "Probably yes". Expected one of: "Yes", "No", "Conditional"/,
    );
  });

  it("rejects an answer from an agency the roster says was not surveyed", () => {
    expect(() => sources({ answers: ["Pierce Runner,lift,Yes,"] })).toThrow(
      /"Pierce Runner" has an answer, but the Agencies tab does not mark its Capability survey as Returned/,
    );
  });

  it("rejects an unknown capability id and a second answer for the same cell", () => {
    expect(() => sources({ answers: ["Hyde Shuttle,ramp,Yes,"] })).toThrow(
      /unknown Capability ID "ramp"/,
    );
    expect(() => sources({ answers: ["Hyde Shuttle,lift,Yes,", "Hyde Shuttle,lift,No,"] })).toThrow(
      /a second answer from "Hyde Shuttle" for "lift"/,
    );
  });
});

describe("Question-capability map tab", () => {
  it("links by id, carrying the editorial note and omitting it when blank", () => {
    const { questionLinks } = sources({
      map: ["accessibility-needs,lift,Editorial claim", "do-you-need-a-lift,lift,"],
    });
    expect(questionLinks).toEqual([
      { questionId: "accessibility-needs", capabilityId: "lift", note: "Editorial claim" },
      { questionId: "do-you-need-a-lift", capabilityId: "lift" },
    ]);
  });

  it("rejects an unknown capability, but leaves question ids to be resolved at runtime", () => {
    expect(() => sources({ map: ["accessibility-needs,hovercraft,"] })).toThrow(
      /unknown Capability ID "hovercraft"/,
    );
    expect(() => sources({ map: ["no-such-question,lift,"] })).not.toThrow();
  });
});

describe("resolveQuestionCapabilityLinks", () => {
  const links = [
    { questionId: "accessibility-needs", capabilityId: "lift" },
    { questionId: "accessibility-needs", capabilityId: "wheelchair-accessible" },
    { questionId: "a-removed-question", capabilityId: "lift" },
  ];

  it("groups links by the question they match", () => {
    const { byQuestionId } = resolveQuestionCapabilityLinks(links, [
      question("accessibility-needs"),
    ]);
    expect(byQuestionId.get("accessibility-needs")).toHaveLength(2);
  });

  it("reports a link whose question is absent instead of dropping it silently", () => {
    const { unmatched } = resolveQuestionCapabilityLinks(links, [question("accessibility-needs")]);
    expect(unmatched).toEqual([{ questionId: "a-removed-question", capabilityId: "lift" }]);
  });
});
