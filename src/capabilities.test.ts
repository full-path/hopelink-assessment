import { describe, expect, it } from "vitest";
import {
  computeCapabilityVariance,
  computeCoverage,
  computeQuestionCapabilityInsight,
} from "./capabilities";
import type {
  Agency,
  AgencyCapabilityProfile,
  IntakeQuestion,
  RequirementLevel,
} from "./data/types";

function profile(agencyId: string, lift: string | null): AgencyCapabilityProfile {
  return {
    agencyId,
    capabilities: [
      lift === null
        ? { capabilityId: "lift", value: "unknown" as const }
        : { capabilityId: "lift", value: lift as "yes" | "no" | "conditional" },
    ],
  };
}

function agency(id: string, kind: Agency["kind"]): Agency {
  return { id, displayName: id, kind, aliases: [id] };
}

function question(id: string, asked: [string, RequirementLevel][]): IntakeQuestion {
  return {
    id,
    text: id,
    requirements: asked.map(([agencyId, level]) => ({ agencyId, level })),
    upstreamRefs: [],
    downstreamRefs: [],
  };
}

describe("computeCapabilityVariance", () => {
  it("reports 'varies' when responding providers disagree", () => {
    const variance = computeCapabilityVariance("lift", [
      profile("a", "yes"),
      profile("b", "no"),
      profile("c", null),
    ]);
    expect(variance.verdict).toBe("varies");
    expect(variance.answered).toBe(2);
    expect(variance.counts).toEqual({ yes: 1, no: 1, conditional: 0, unknown: 1 });
  });

  it("counts a conditional answer as disagreeing with an unqualified yes", () => {
    const variance = computeCapabilityVariance("lift", [
      profile("a", "yes"),
      profile("b", "conditional"),
    ]);
    expect(variance.verdict).toBe("varies");
  });

  it("reports 'uniform' with the shared value when every responder agrees", () => {
    const variance = computeCapabilityVariance("lift", [
      profile("a", "yes"),
      profile("b", "yes"),
      profile("c", null),
    ]);
    expect(variance.verdict).toBe("uniform");
    expect(variance.uniformValue).toBe("yes");
  });

  it("does not let blank answers turn a uniform capability into a varying one", () => {
    const variance = computeCapabilityVariance("lift", [
      profile("a", "no"),
      profile("b", "no"),
      profile("c", null),
      profile("d", null),
    ]);
    expect(variance.verdict).toBe("uniform");
    expect(variance.uniformValue).toBe("no");
  });

  it("withholds a verdict when fewer than two providers answered", () => {
    const variance = computeCapabilityVariance("lift", [profile("a", "yes"), profile("b", null)]);
    expect(variance.verdict).toBe("insufficient_data");
    expect(variance.uniformValue).toBeUndefined();
  });

  it("counts qualified answers so a uniform verdict can be presented as a soft one", () => {
    const variance = computeCapabilityVariance("lift", [
      { agencyId: "a", capabilities: [{ capabilityId: "lift", value: "yes", qualifier: "1" }] },
      { agencyId: "b", capabilities: [{ capabilityId: "lift", value: "yes" }] },
    ]);
    expect(variance.verdict).toBe("uniform");
    expect(variance.qualified).toBe(1);
  });
});

describe("computeQuestionCapabilityInsight", () => {
  const links = [{ questionText: "q", capabilityId: "lift" }];
  const varying = [profile("a", "yes"), profile("b", "no")];
  const uniform = [profile("a", "yes"), profile("b", "yes")];
  const providers = new Set(["a", "b", "c", "d"]);

  it("flags a question as a unified intake candidate when the capability varies and few ask it", () => {
    const insight = computeQuestionCapabilityInsight(
      question("q", [["a", "optional"]]),
      links,
      varying,
      providers,
    );
    expect(insight.verdict).toBe("differentiating");
    expect(insight.askedByProviderCount).toBe(1);
    expect(insight.unifiedIntakeCandidate).toBe(true);
  });

  it("does not flag a question whose capability is the same for every provider", () => {
    const insight = computeQuestionCapabilityInsight(
      question("q", [["a", "optional"]]),
      links,
      uniform,
      providers,
    );
    expect(insight.verdict).toBe("uniform");
    expect(insight.unifiedIntakeCandidate).toBe(false);
  });

  it("does not flag a differentiating question that most providers already ask", () => {
    const insight = computeQuestionCapabilityInsight(
      question("q", [
        ["a", "required"],
        ["b", "required"],
        ["c", "optional"],
      ]),
      links,
      varying,
      providers,
    );
    expect(insight.verdict).toBe("differentiating");
    expect(insight.unifiedIntakeCandidate).toBe(false);
  });

  it("counts only ride providers when measuring who asks the question", () => {
    const insight = computeQuestionCapabilityInsight(
      question("q", [
        ["a", "required"],
        ["orca", "required"],
      ]),
      links,
      varying,
      providers,
    );
    expect(insight.askedByProviderCount).toBe(1);
    expect(insight.totalProviderCount).toBe(4);
  });
});

describe("computeCoverage", () => {
  const agencies = [
    agency("reported", "ride_provider"),
    agency("blank-row", "ride_provider"),
    agency("no-row", "ride_provider"),
    agency("fare", "fare_program"),
  ];
  const profiles = [profile("reported", "yes"), profile("blank-row", null)];

  it("separates a blank survey response from never having been surveyed", () => {
    const coverage = computeCoverage(agencies, profiles, []);
    const byId = new Map(coverage.map((entry) => [entry.agencyId, entry.status]));
    expect(byId.get("reported")).toBe("reported");
    expect(byId.get("blank-row")).toBe("surveyed_no_answers");
    expect(byId.get("no-row")).toBe("not_surveyed");
  });

  it("marks a fare program as not applicable rather than as a missing survey", () => {
    const coverage = computeCoverage(agencies, profiles, []);
    expect(coverage.find((entry) => entry.agencyId === "fare")?.status).toBe("not_applicable");
  });

  it("flags an agency that reports capabilities but appears in no intake question", () => {
    const coverage = computeCoverage(agencies, profiles, [
      question("q", [["blank-row", "required"]]),
    ]);
    const byId = new Map(coverage.map((entry) => [entry.agencyId, entry.missingIntakeData]));
    expect(byId.get("reported")).toBe(true);
    expect(byId.get("blank-row")).toBe(false);
  });
});
