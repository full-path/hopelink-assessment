import Papa from "papaparse";
import type { Agency, AgencyRequirement, IntakeQuestion, NormalizedData } from "./types";
import { createAgencyResolver } from "./agencies";
import { cell, dropdown, ID_PATTERN, parseTab, type Row } from "./tabs";
import { normalizeWhitespace } from "./text";

/**
 * The question tabs — Questions, Requirements, Question links — → NormalizedData.
 *
 * Shared by three callers: `scripts/build-data.ts` (the committed snapshot), the live sheet
 * loader (`src/sheetSource.ts`), and the in-browser upload preview (`src/main.ts`). Because it
 * runs in the browser, it must stay free of Node imports.
 *
 * The layout is one value per cell, so this module validates rather than untangles: an id is
 * looked up, a dropdown value is checked against its list, and anything that doesn't match is
 * an error naming the tab and row — with one deliberate exception, a link to an unknown
 * question, which is kept and surfaced as unresolved (CLAUDE.md Section 11, item 2).
 */

/** The three question tabs as raw CSV text. */
export interface QuestionSourceTexts {
  questions: string;
  requirements: string;
  questionLinks: string;
}

const QUESTIONS_COLUMNS = ["ID", "Question"];
const REQUIREMENTS_COLUMNS = ["Question ID", "Agency", "Asked", "Verification", "Proof detail"];
const LINKS_COLUMNS = ["Question ID", "Leads to"];

/** Is the question mandatory? Blank is allowed: see the Requirements rules below. */
const ASKED = { Required: "required", Optional: "optional" } as const;
/** How is the answer checked? */
const VERIFICATION = {
  "Self-attestation": "self_attestation",
  "Proof required": "proof_required",
} as const;

/**
 * One row of the Requirements tab → its `AgencyRequirement` entries.
 *
 * The tab records two separate facts per (question, agency) — whether the question is
 * mandatory, and how the answer is checked — which the contract represents as up to two entries
 * on the same ordinal scale. A row with only a Verification is accepted: it is a real gap in
 * what the agency reported (it checks an answer to a question it never said it asks), and
 * rejecting it would hide that rather than show it.
 */
function requirementEntries(row: Row, agencyId: string, where: string): AgencyRequirement[] {
  const asked = dropdown(cell(row, "Asked"), ASKED, () => `${where}: Asked`);
  const verification = dropdown(
    cell(row, "Verification"),
    VERIFICATION,
    () => `${where}: Verification`,
  );
  const proofDetail = cell(row, "Proof detail");

  if (asked === null && verification === null) {
    throw new Error(`${where} has neither Asked nor Verification; fill one in or delete the row.`);
  }
  if (proofDetail && verification !== "proof_required") {
    throw new Error(`${where} has Proof detail but Verification is not "Proof required".`);
  }

  const entries: AgencyRequirement[] = [];
  if (asked !== null) entries.push({ agencyId, level: asked });
  if (verification !== null) {
    entries.push({
      agencyId,
      level: verification,
      ...(proofDetail ? { proofDetail } : {}),
    });
  }
  return entries;
}

export function normalizeQuestions(
  sources: QuestionSourceTexts,
  agencies: Agency[],
): NormalizedData {
  const resolveAgencyId = createAgencyResolver(agencies);

  // --- Questions -----------------------------------------------------------------------------
  const questions: IntakeQuestion[] = [];
  const byId = new Map<string, IntakeQuestion>();
  parseTab(sources.questions, "Questions", QUESTIONS_COLUMNS).forEach((row, index) => {
    const where = `Questions tab, row ${String(index + 2)}`;
    const id = cell(row, "ID");
    const text = cell(row, "Question");
    if (!ID_PATTERN.test(id)) {
      throw new Error(
        `${where}: ID "${id}" must be lowercase words joined by hyphens, e.g. "home-address".`,
      );
    }
    if (!text) throw new Error(`${where}: question "${id}" has no text.`);
    if (byId.has(id)) throw new Error(`${where}: duplicate question ID "${id}".`);

    const dataQualityNote = cell(row, "Data Quality Notes");
    const question: IntakeQuestion = {
      id,
      text,
      requirements: [],
      upstreamRefs: [],
      downstreamRefs: [],
      ...(dataQualityNote ? { dataQualityNote } : {}),
    };
    questions.push(question);
    byId.set(id, question);
  });

  // --- Requirements --------------------------------------------------------------------------
  const seenPairs = new Set<string>();
  parseTab(sources.requirements, "Requirements", REQUIREMENTS_COLUMNS).forEach((row, index) => {
    const where = `Requirements tab, row ${String(index + 2)}`;
    const questionId = cell(row, "Question ID");
    const question = byId.get(questionId);
    if (!question) throw new Error(`${where}: unknown Question ID "${questionId}".`);
    const agencyId = resolveAgencyId(cell(row, "Agency"));

    // One row per pair is what makes a contradiction ("both Required and Optional") impossible
    // to enter; a second row for the same pair would bring it straight back.
    const pair = `${questionId}\u0000${agencyId}`;
    if (seenPairs.has(pair)) {
      throw new Error(
        `${where}: a second row for "${cell(row, "Agency")}" on "${questionId}". ` +
          `Each agency gets one row per question.`,
      );
    }
    seenPairs.add(pair);

    question.requirements.push(...requirementEntries(row, agencyId, where));
  });

  // --- Question links ------------------------------------------------------------------------
  // Each link is recorded once, in the direction it gates; both ends are derived from it. A link
  // naming an unknown question is kept as unresolved on the end that does exist, not dropped.
  const seenLinks = new Set<string>();
  parseTab(sources.questionLinks, "Question links", LINKS_COLUMNS).forEach((row, index) => {
    const where = `Question links tab, row ${String(index + 2)}`;
    const fromId = cell(row, "Question ID");
    const toId = cell(row, "Leads to");
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from && !to) {
      throw new Error(`${where}: neither "${fromId}" nor "${toId}" is a known question ID.`);
    }
    if (fromId === toId) throw new Error(`${where}: "${fromId}" leads to itself.`);
    const key = `${fromId}\u0000${toId}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);

    if (from && to) {
      from.downstreamRefs.push(toId);
      to.upstreamRefs.push(fromId);
    } else if (from) {
      (from.unresolvedLinks ??= []).push(toId);
    } else if (to) {
      (to.unresolvedLinks ??= []).push(fromId);
    }
  });

  return { agencies, questions };
}

/**
 * Which question tab a CSV is, judged by its header row — for the upload preview, where a reader
 * drops in exported tabs whose file names Google chooses ("Sheet name - Questions.csv" and
 * the like), so the name cannot be relied on.
 */
const TAB_SIGNATURES: [keyof QuestionSourceTexts, string, string[]][] = [
  ["requirements", "Requirements", ["Question ID", "Agency", "Asked", "Verification"]],
  ["questionLinks", "Question links", ["Question ID", "Leads to"]],
  ["questions", "Questions", ["ID", "Question"]],
];

export interface UploadedFile {
  name: string;
  text: string;
}

/**
 * Sorts uploaded files into the three question tabs, or throws naming what is wrong: a file that
 * matches no tab, two files for one tab, or a tab with no file. All three are required; the
 * snapshot has no raw CSV to fill a gap with, and guessing would show a mix of two datasets.
 */
export function assembleQuestionUpload(files: UploadedFile[]): QuestionSourceTexts {
  const found: Partial<Record<keyof QuestionSourceTexts, UploadedFile>> = {};
  for (const file of files) {
    const fields = (
      Papa.parse<string[]>(file.text, { preview: 1, delimiter: "," }).data[0] ?? []
    ).map(normalizeWhitespace);
    const match = TAB_SIGNATURES.find(([, , columns]) => columns.every((c) => fields.includes(c)));
    if (!match) {
      throw new Error(
        `"${file.name}" is not a Questions, Requirements or Question links tab ` +
          `(its columns are ${fields.map((c) => `"${c}"`).join(", ")}).`,
      );
    }
    const [role, tab] = match;
    const existing = found[role];
    if (existing) {
      throw new Error(`"${existing.name}" and "${file.name}" are both a ${tab} tab.`);
    }
    found[role] = file;
  }

  const missing = TAB_SIGNATURES.filter(([role]) => !found[role]).map(([, tab]) => tab);
  if (missing.length > 0) {
    throw new Error(
      `A preview needs the Questions, Requirements and Question links tabs together; ` +
        `missing ${missing.join(", ")}.`,
    );
  }
  return {
    questions: found.questions?.text ?? "",
    requirements: found.requirements?.text ?? "",
    questionLinks: found.questionLinks?.text ?? "",
  };
}
