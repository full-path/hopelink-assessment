import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assembleQuestionUpload, normalizeQuestions, type QuestionSourceTexts } from "./normalize";
import { createAgencyResolver, parseAgencyRoster } from "./agencies";
import { slugify } from "./text";

/** The committed roster, so these tests exercise the real alias table rather than a stand-in. */
const ROSTER = parseAgencyRoster(
  readFileSync(new URL("../../data/agencies.csv", import.meta.url), "utf-8"),
);
const resolveAgencyId = createAgencyResolver(ROSTER);

const QUESTIONS_HEADER = "ID,Question,Data Quality Notes";
const REQUIREMENTS_HEADER = "Question ID,Agency,Asked,Verification,Proof detail";
const LINKS_HEADER = "Question ID,Leads to,Note";

/** Builds the three tabs from row lines; the header is added for you. */
function tabs(
  rows: { questions?: string[]; requirements?: string[]; links?: string[] } = {},
): QuestionSourceTexts {
  return {
    questions: [QUESTIONS_HEADER, ...(rows.questions ?? ["phone,Phone,", "email,Email,"])].join(
      "\n",
    ),
    requirements: [REQUIREMENTS_HEADER, ...(rows.requirements ?? [])].join("\n"),
    questionLinks: [LINKS_HEADER, ...(rows.links ?? [])].join("\n"),
  };
}

const normalize = (sources: QuestionSourceTexts) => normalizeQuestions(sources, ROSTER);
const find = (sources: QuestionSourceTexts, id: string) =>
  normalize(sources).questions.find((q) => q.id === id);

describe("resolveAgencyId (committed roster)", () => {
  it("resolves the capabilities sheet's short name for Sound Generations VTS", () => {
    expect(resolveAgencyId("SG VTS")).toBe("sound-generations-vts");
    expect(resolveAgencyId("Sound Generations VTS")).toBe("sound-generations-vts");
  });

  it("resolves known casing variants to the same canonical id", () => {
    expect(resolveAgencyId("Beyond the borders")).toBe("beyond-the-borders");
    expect(resolveAgencyId("Access paratransit")).toBe("access-paratransit");
    expect(resolveAgencyId("ORCA (disabled)")).toBe("orca-disabled");
  });

  it("treats bare ORCA and ORCA program variants as distinct agencies", () => {
    expect(resolveAgencyId("ORCA")).toBe("orca");
    expect(resolveAgencyId("ORCA (Senior)")).toBe("orca-senior");
    expect(resolveAgencyId("ORCA LIFT")).toBe("orca-lift");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates text, dropping trailing punctuation", () => {
    expect(slugify("Are you currently homeless?")).toBe("are-you-currently-homeless");
  });
});

describe("Questions tab", () => {
  it("takes each question's id from the sheet, not from its text, in sheet order", () => {
    const data = normalize(tabs({ questions: ["phone,Telephone number,", "email,Email,"] }));
    expect(data.questions.map((q) => [q.id, q.text])).toEqual([
      ["phone", "Telephone number"],
      ["email", "Email"],
    ]);
  });

  it("carries a data quality note through, omitting it when blank", () => {
    const data = normalize(
      tabs({ questions: ['phone,Phone,"Check this, please"', "email,Email,"] }),
    );
    expect(data.questions[0]?.dataQualityNote).toBe("Check this, please");
    expect(data.questions[1]).not.toHaveProperty("dataQualityNote");
  });

  it("rejects an id that is not lowercase words joined by hyphens", () => {
    expect(() => normalize(tabs({ questions: ["Home Address,Home address,"] }))).toThrow(
      /Questions tab, row 2: ID "Home Address" must be lowercase words/,
    );
  });

  it("rejects a duplicate id", () => {
    expect(() => normalize(tabs({ questions: ["phone,Phone,", "phone,Telephone,"] }))).toThrow(
      /row 3: duplicate question ID "phone"/,
    );
  });

  it("rejects a question with an id but no text", () => {
    expect(() => normalize(tabs({ questions: ["phone,,"] }))).toThrow(/"phone" has no text/);
  });

  it("names the tab when a required column is missing", () => {
    expect(() => normalizeQuestions({ ...tabs(), questions: "Question\nPhone" }, ROSTER)).toThrow(
      /Questions tab is missing expected column\(s\): "ID"/,
    );
  });

  it("ignores extra columns, so the sheet can carry helper columns", () => {
    const data = normalize({
      ...tabs(),
      requirements: `${REQUIREMENTS_HEADER},Question text (lookup)\nphone,ORCA,Required,,,Phone`,
    });
    expect(data.questions[0]?.requirements).toEqual([{ agencyId: "orca", level: "required" }]);
  });
});

describe("Requirements tab", () => {
  it("turns Asked and Verification into one entry each, with proof detail on the proof entry", () => {
    const question = find(
      tabs({ requirements: ["phone,ORCA,Required,Proof required,Photo ID"] }),
      "phone",
    );
    expect(question?.requirements).toEqual([
      { agencyId: "orca", level: "required" },
      { agencyId: "orca", level: "proof_required", proofDetail: "Photo ID" },
    ]);
  });

  it("keeps a proof detail containing commas and parentheses intact", () => {
    // The old layout packed several agencies' proof into one cell, delimited by ";", because
    // proof text itself contains commas. One value per cell removes the problem entirely.
    const detail = "ProviderOne number OR EBT number (any), or a pay stub";
    const question = find(
      tabs({ requirements: [`phone,ORCA,,Proof required,"${detail}"`] }),
      "phone",
    );
    expect(question?.requirements).toEqual([
      { agencyId: "orca", level: "proof_required", proofDetail: detail },
    ]);
  });

  it("accepts a Verification with no Asked, keeping the gap visible rather than rejecting it", () => {
    const question = find(tabs({ requirements: ["email,ORCA,,Self-attestation,"] }), "email");
    expect(question?.requirements).toEqual([{ agencyId: "orca", level: "self_attestation" }]);
  });

  it("matches dropdown values case-insensitively", () => {
    const question = find(
      tabs({ requirements: ["phone,ORCA,optional,SELF-ATTESTATION,"] }),
      "phone",
    );
    expect(question?.requirements.map((r) => r.level)).toEqual(["optional", "self_attestation"]);
  });

  it("rejects a value outside a dropdown, listing the allowed ones", () => {
    expect(() => normalize(tabs({ requirements: ["phone,ORCA,Mandatory,,"] }))).toThrow(
      /Requirements tab, row 2: Asked is "Mandatory". Expected one of: "Required", "Optional"/,
    );
  });

  it("rejects a row with neither Asked nor Verification", () => {
    expect(() => normalize(tabs({ requirements: ["phone,ORCA,,,"] }))).toThrow(
      /has neither Asked nor Verification/,
    );
  });

  it("rejects proof detail unless Verification is Proof required", () => {
    expect(() =>
      normalize(tabs({ requirements: ["phone,ORCA,Required,Self-attestation,Photo ID"] })),
    ).toThrow(/Proof detail but Verification is not "Proof required"/);
  });

  it("rejects a second row for one agency and question, the contradiction the old layout allowed", () => {
    // Spelled two ways on purpose: the pair is checked after alias resolution.
    expect(() =>
      normalize(
        tabs({
          requirements: [
            "phone,Beyond the Borders,Required,,",
            "phone,Beyond the borders,Optional,,",
          ],
        }),
      ),
    ).toThrow(/row 3: a second row for "Beyond the borders" on "phone"/);
  });

  it("allows the same agency on different questions", () => {
    const data = normalize(
      tabs({ requirements: ["phone,ORCA,Required,,", "email,ORCA,Optional,,"] }),
    );
    expect(data.questions.map((q) => q.requirements.length)).toEqual([1, 1]);
  });

  it("rejects an unknown question id", () => {
    expect(() => normalize(tabs({ requirements: ["fax,ORCA,Required,,"] }))).toThrow(
      /Requirements tab, row 2: unknown Question ID "fax"/,
    );
  });

  it("rejects an agency that is not on the roster", () => {
    expect(() => normalize(tabs({ requirements: ["phone,Some New Agency,Required,,"] }))).toThrow(
      /Unrecognized agency name "Some New Agency"/,
    );
  });
});

describe("Question links tab", () => {
  it("records each link once and derives both ends from it", () => {
    const data = normalize(tabs({ links: ["phone,email,"] }));
    expect(data.questions[0]).toMatchObject({ upstreamRefs: [], downstreamRefs: ["email"] });
    expect(data.questions[1]).toMatchObject({ upstreamRefs: ["phone"], downstreamRefs: [] });
  });

  it("ignores a link entered twice", () => {
    const data = normalize(tabs({ links: ["phone,email,", "phone,email,"] }));
    expect(data.questions[0]?.downstreamRefs).toEqual(["email"]);
  });

  it("keeps a link to an unknown question as unresolved rather than dropping it", () => {
    const data = normalize(tabs({ links: ["phone,preferred-contact,"] }));
    expect(data.questions[0]?.unresolvedLinks).toEqual(["preferred-contact"]);
    expect(data.questions[0]?.downstreamRefs).toEqual([]);
    expect(data.questions[1]).not.toHaveProperty("unresolvedLinks");
  });

  it("keeps a link from an unknown question as unresolved on the end that exists", () => {
    const data = normalize(tabs({ links: ["old-question,email,"] }));
    expect(data.questions[1]?.unresolvedLinks).toEqual(["old-question"]);
  });

  it("rejects a link where neither end is a known question", () => {
    expect(() => normalize(tabs({ links: ["fax,pager,"] }))).toThrow(
      /neither "fax" nor "pager" is a known question ID/,
    );
  });

  it("rejects a question leading to itself", () => {
    expect(() => normalize(tabs({ links: ["phone,phone,"] }))).toThrow(/"phone" leads to itself/);
  });
});

describe("assembleQuestionUpload", () => {
  const { questions, requirements, questionLinks } = tabs();

  it("recognises each tab by its header row, whatever the file is called and in any order", () => {
    expect(
      assembleQuestionUpload([
        { name: "Sheet - Question links.csv", text: questionLinks },
        { name: "export (1).csv", text: questions },
        { name: "export (2).csv", text: requirements },
      ]),
    ).toEqual({ questions, requirements, questionLinks });
  });

  it("names the tabs that are missing", () => {
    expect(() => assembleQuestionUpload([{ name: "q.csv", text: questions }])).toThrow(
      /missing Requirements, Question links/,
    );
  });

  it("rejects two files for the same tab", () => {
    expect(() =>
      assembleQuestionUpload([
        { name: "a.csv", text: questions },
        { name: "b.csv", text: questions },
      ]),
    ).toThrow(/"a.csv" and "b.csv" are both a Questions tab/);
  });

  it("rejects a file that is none of the three tabs", () => {
    expect(() =>
      assembleQuestionUpload([{ name: "capabilities.csv", text: "ID,Label\nlift,Lift" }]),
    ).toThrow(/"capabilities.csv" is not a Questions, Requirements or Question links tab/);
  });
});
