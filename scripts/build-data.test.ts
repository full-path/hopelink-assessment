import { describe, expect, it } from "vitest";
import {
  normalize,
  parseAgencyList,
  parseBurdenOfProof,
  parseCsv,
  resolveAgencyId,
  slugify,
} from "./build-data";

describe("resolveAgencyId", () => {
  it("resolves an exact canonical name", () => {
    expect(resolveAgencyId("Hyde Shuttle")).toBe("hyde-shuttle");
  });

  it("resolves known casing variants to the same canonical id", () => {
    expect(resolveAgencyId("Beyond the borders")).toBe("beyond-the-borders");
    expect(resolveAgencyId("Beyond the Borders")).toBe("beyond-the-borders");
    expect(resolveAgencyId("Access paratransit")).toBe("access-paratransit");
    expect(resolveAgencyId("ORCA (disabled)")).toBe("orca-disabled");
  });

  it("trims surrounding and collapses internal whitespace before matching", () => {
    expect(resolveAgencyId("  ORCA  ")).toBe("orca");
  });

  it("treats bare ORCA and ORCA program variants as distinct agencies", () => {
    expect(resolveAgencyId("ORCA")).toBe("orca");
    expect(resolveAgencyId("ORCA (Senior)")).toBe("orca-senior");
    expect(resolveAgencyId("ORCA (Disabled)")).toBe("orca-disabled");
    expect(resolveAgencyId("ORCA LIFT")).toBe("orca-lift");
  });

  it("throws on an unrecognized agency name rather than silently dropping it", () => {
    expect(() => resolveAgencyId("Some New Agency")).toThrow(/Unrecognized agency name/);
  });
});

describe("parseAgencyList", () => {
  it("returns an empty array for an empty cell", () => {
    expect(parseAgencyList("")).toEqual([]);
    expect(parseAgencyList("   ")).toEqual([]);
  });

  it("splits a comma-delimited list and resolves each agency", () => {
    expect(parseAgencyList("Hyde Shuttle, ORCA LIFT, Beyond the Borders")).toEqual([
      "hyde-shuttle",
      "orca-lift",
      "beyond-the-borders",
    ]);
  });

  it("resolves a single-agency cell", () => {
    expect(parseAgencyList("Homage TAP")).toEqual(["homage-tap"]);
  });
});

describe("parseBurdenOfProof", () => {
  it("returns an empty array for an empty cell", () => {
    expect(parseBurdenOfProof("")).toEqual([]);
  });

  it("parses a single agency with embedded proof detail", () => {
    expect(parseBurdenOfProof("ORCA (Photo ID)")).toEqual([
      { agencyId: "orca", level: "proof_required", proofDetail: "Photo ID" },
    ]);
  });

  it("splits multiple semicolon-delimited agency/proof segments without breaking on commas inside proof detail", () => {
    expect(
      parseBurdenOfProof(
        "ORCA (ProviderOne number OR EBT number OR DSHS Client ID number); Access Paratransit (signed note from doctor)",
      ),
    ).toEqual([
      {
        agencyId: "orca",
        level: "proof_required",
        proofDetail: "ProviderOne number OR EBT number OR DSHS Client ID number",
      },
      {
        agencyId: "access-paratransit",
        level: "proof_required",
        proofDetail: "signed note from doctor",
      },
    ]);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates question text", () => {
    expect(slugify("First and last")).toBe("first-and-last");
  });

  it("strips trailing punctuation", () => {
    expect(slugify("Are you currently homeless?")).toBe("are-you-currently-homeless");
  });
});

describe("normalize", () => {
  const baseRow = {
    Question: "",
    "Providers Required": "",
    "Providers Optional": "",
    "Providers Self Attestation": "",
    "Providers Burden of Proof": "",
    "Upstream Q's": "",
    "Downstream Q's": "",
  };

  it("resolves an upstream/downstream link that matches another question's text exactly", () => {
    const rows = [
      { ...baseRow, Question: "Race", "Downstream Q's": "Ethnicity" },
      { ...baseRow, Question: "Ethnicity", "Upstream Q's": "Race" },
    ];
    const data = normalize(rows);
    const race = data.questions.find((q) => q.id === "race");
    const ethnicity = data.questions.find((q) => q.id === "ethnicity");
    expect(race?.downstreamRefs).toEqual(["ethnicity"]);
    expect(race?.unresolvedLinks).toBeUndefined();
    expect(ethnicity?.upstreamRefs).toEqual(["race"]);
  });

  it("flags a non-matching upstream/downstream reference as unresolved instead of dropping or guessing", () => {
    const rows = [
      {
        ...baseRow,
        Question: "Home address",
        "Downstream Q's": "Mailing address same as home address?",
      },
    ];
    const data = normalize(rows);
    const question = data.questions[0];
    expect(question?.downstreamRefs).toEqual([]);
    expect(question?.unresolvedLinks).toEqual(["Mailing address same as home address?"]);
  });

  it("carries a Data Quality Notes cell through verbatim when present", () => {
    const rows = [
      {
        ...baseRow,
        Question: "Phone",
        "Providers Required": "ORCA",
        "Providers Optional": "ORCA",
        "Data Quality Notes": "ORCA is listed under both Required and Optional.",
      },
    ];
    const data = normalize(rows);
    expect(data.questions[0]?.dataQualityNote).toBe(
      "ORCA is listed under both Required and Optional.",
    );
  });

  it("omits dataQualityNote entirely when the cell is blank", () => {
    const rows = [{ ...baseRow, Question: "Gender" }];
    const data = normalize(rows);
    expect(data.questions[0]?.dataQualityNote).toBeUndefined();
  });

  it("throws when two rows produce the same slug id", () => {
    const rows = [
      { ...baseRow, Question: "Phone" },
      { ...baseRow, Question: "phone" },
    ];
    expect(() => normalize(rows)).toThrow(/Duplicate question id/);
  });
});

describe("parseCsv", () => {
  it("skips a fully blank row between the header and data, as seen in past CSV revisions", () => {
    const csv = [
      "Question,Providers Required,Providers Optional,Providers Self Attestation,Providers Burden of Proof,Upstream Q's,Downstream Q's",
      ",,,,,,",
      "Phone,Hyde Shuttle,,,,,",
    ].join("\n");
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Question).toBe("Phone");
  });
});
