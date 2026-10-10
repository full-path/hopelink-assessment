import type {
  Agency,
  AgencyCapability,
  AgencyCapabilityProfile,
  Capability,
  CapabilityData,
  CapabilityValue,
  IntakeQuestion,
  QuestionCapabilityLink,
} from "./types";
import { createAgencyResolver } from "./agencies";
import { cell, dropdown, ID_PATTERN, parseTab } from "./tabs";

/**
 * The capability tabs — Capabilities, Provider capabilities, Question-capability map — →
 * CapabilityData.
 *
 * Sibling of `normalize.ts`, following the same rules: one shared module, no Node imports (it
 * runs in the browser too), strict about anything it cannot resolve. Between them they share
 * only the agency roster (`agencies.ts`) and the tab helpers (`tabs.ts`).
 *
 * Answers are long-form: one row per (agency, capability) the agency answered. A missing row is
 * `unknown`, never `no` — see the `CapabilityValue` docs in `types.ts` for why that distinction
 * is load-bearing. Which agencies have a profile at all comes from the roster's
 * `Capability survey` column, not from which agencies happen to have answer rows.
 */

/** The three capability tabs as raw CSV text. */
export interface CapabilitySourceTexts {
  capabilities: string;
  providerCapabilities: string;
  capabilityMap: string;
}

const CAPABILITIES_COLUMNS = ["ID", "Label"];
const ANSWERS_COLUMNS = ["Agency", "Capability ID", "Answer", "Agency's wording"];
const MAP_COLUMNS = ["Question ID", "Capability ID"];

/**
 * The Answer dropdown. "Conditional" covers every hedged answer — "Probably yes", "Depends on
 * vehicle" — because a hedge is not the same claim as an unqualified yes, and flattening it
 * would overstate what the agency said; the hedge itself goes in "Agency's wording".
 */
const ANSWER = {
  Yes: "yes",
  No: "no",
  Conditional: "conditional",
} as const satisfies Record<string, CapabilityValue>;

function parseCapabilities(csvText: string): Capability[] {
  const capabilities: Capability[] = [];
  const seen = new Set<string>();
  parseTab(csvText, "Capabilities", CAPABILITIES_COLUMNS).forEach((row, index) => {
    const where = `Capabilities tab, row ${String(index + 2)}`;
    const id = cell(row, "ID");
    const label = cell(row, "Label");
    if (!ID_PATTERN.test(id)) {
      throw new Error(
        `${where}: ID "${id}" must be lowercase words joined by hyphens, e.g. "wheelchair-accessible".`,
      );
    }
    if (!label) throw new Error(`${where}: capability "${id}" has no label.`);
    if (seen.has(id)) throw new Error(`${where}: duplicate capability ID "${id}".`);
    seen.add(id);
    capabilities.push({ id, label });
  });
  if (capabilities.length === 0) throw new Error("Capabilities tab has no capabilities.");
  return capabilities;
}

function parseProfiles(
  csvText: string,
  capabilities: Capability[],
  agencies: Agency[],
): AgencyCapabilityProfile[] {
  const resolveAgencyId = createAgencyResolver(agencies);
  const capabilityIds = new Set(capabilities.map((c) => c.id));
  const surveyed = new Set(
    agencies.filter((a) => a.capabilitySurvey === "returned").map((a) => a.id),
  );
  const answers = new Map<string, Map<string, AgencyCapability>>();

  parseTab(csvText, "Provider capabilities", ANSWERS_COLUMNS).forEach((row, index) => {
    const where = `Provider capabilities tab, row ${String(index + 2)}`;
    const agencyName = cell(row, "Agency");
    const agencyId = resolveAgencyId(agencyName);
    if (!surveyed.has(agencyId)) {
      throw new Error(
        `${where}: "${agencyName}" has an answer, but the Agencies tab does not mark its ` +
          `Capability survey as Returned.`,
      );
    }
    const capabilityId = cell(row, "Capability ID");
    if (!capabilityIds.has(capabilityId)) {
      throw new Error(`${where}: unknown Capability ID "${capabilityId}".`);
    }

    const value = dropdown(cell(row, "Answer"), ANSWER, () => `${where}: Answer`) ?? "unknown";
    const qualifier = cell(row, "Agency's wording");

    const byCapability = answers.get(agencyId) ?? new Map<string, AgencyCapability>();
    if (byCapability.has(capabilityId)) {
      throw new Error(`${where}: a second answer from "${agencyName}" for "${capabilityId}".`);
    }
    byCapability.set(capabilityId, { capabilityId, value, ...(qualifier ? { qualifier } : {}) });
    answers.set(agencyId, byCapability);
  });

  // Every surveyed agency gets a full profile in capability order, unanswered cells "unknown" —
  // the same shape the view has always received, whichever answers happen to have rows.
  return agencies
    .filter((agency) => surveyed.has(agency.id))
    .map((agency) => ({
      agencyId: agency.id,
      capabilities: capabilities.map(
        (capability): AgencyCapability =>
          answers.get(agency.id)?.get(capability.id) ?? {
            capabilityId: capability.id,
            value: "unknown",
          },
      ),
    }));
}

/**
 * The editorial question → capability map. Capability ids must exist (an unknown one is an
 * error), but question ids are only checked for shape: they are resolved against whichever
 * question set is displayed — see `resolveQuestionCapabilityLinks`.
 */
function parseQuestionCapabilityMap(
  csvText: string,
  capabilities: Capability[],
): QuestionCapabilityLink[] {
  const capabilityIds = new Set(capabilities.map((c) => c.id));
  return parseTab(csvText, "Question-capability map", MAP_COLUMNS).map((row, index) => {
    const where = `Question-capability map tab, row ${String(index + 2)}`;
    const questionId = cell(row, "Question ID");
    const capabilityId = cell(row, "Capability ID");
    if (!ID_PATTERN.test(questionId)) {
      throw new Error(`${where}: Question ID "${questionId}" is not a valid ID.`);
    }
    if (!capabilityIds.has(capabilityId)) {
      throw new Error(`${where}: unknown Capability ID "${capabilityId}".`);
    }
    const note = cell(row, "Note");
    return { questionId, capabilityId, ...(note ? { note } : {}) };
  });
}

export function normalizeCapabilities(
  sources: CapabilitySourceTexts,
  agencies: Agency[],
): CapabilityData {
  const capabilities = parseCapabilities(sources.capabilities);
  return {
    capabilities,
    profiles: parseProfiles(sources.providerCapabilities, capabilities, agencies),
    questionLinks: parseQuestionCapabilityMap(sources.capabilityMap, capabilities),
  };
}

export interface ResolvedQuestionCapabilityLinks {
  /** Links keyed by the id of the question they matched. */
  byQuestionId: Map<string, QuestionCapabilityLink[]>;
  /** Links whose question id matched no question in the active dataset. */
  unmatched: QuestionCapabilityLink[];
}

/**
 * Matches the map's question ids against a question set. This runs against whatever question
 * set is currently displayed, so an uploaded preview that removes a question simply loses that
 * link (reported as unmatched) instead of breaking the view.
 */
export function resolveQuestionCapabilityLinks(
  links: QuestionCapabilityLink[],
  questions: IntakeQuestion[],
): ResolvedQuestionCapabilityLinks {
  const questionIds = new Set(questions.map((question) => question.id));
  const byQuestionId = new Map<string, QuestionCapabilityLink[]>();
  const unmatched: QuestionCapabilityLink[] = [];

  for (const link of links) {
    if (!questionIds.has(link.questionId)) {
      unmatched.push(link);
      continue;
    }
    const existing = byQuestionId.get(link.questionId);
    if (existing) {
      existing.push(link);
    } else {
      byQuestionId.set(link.questionId, [link]);
    }
  }

  return { byQuestionId, unmatched };
}
