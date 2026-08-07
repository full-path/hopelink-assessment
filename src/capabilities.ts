import type {
  Agency,
  AgencyCapabilityProfile,
  CapabilityValue,
  IntakeQuestion,
  QuestionCapabilityLink,
} from "./data/types";

/**
 * Analysis over the provider-capability data. Sibling of `summary.ts`: pure functions, no DOM,
 * deliberately kept out of the data contract because it is a view over the data rather than
 * part of it.
 *
 * The stakeholder question this exists to answer is not "who can carry a wheelchair" but
 * "is this intake question doing any work?" — a question only earns a place in a unified intake
 * if the capability behind it actually differs between providers. See CLAUDE.md Section 5,
 * requirement 5.
 */

/** Answers that constitute an actual response, as opposed to a blank cell. */
const ANSWERED_VALUES: CapabilityValue[] = ["yes", "no", "conditional"];

/**
 * Below this many responding providers there is nothing to compare, so no verdict is offered.
 * Two is the minimum at which agreement or disagreement is a meaningful observation at all.
 */
const MIN_RESPONSES_FOR_VERDICT = 2;

export type VarianceVerdict = "varies" | "uniform" | "insufficient_data";

export interface CapabilityVariance {
  capabilityId: string;
  counts: Record<CapabilityValue, number>;
  /** Providers that gave any answer (yes / no / conditional). */
  answered: number;
  /** Of those, how many attached a caveat — a "uniform" verdict with caveats is a soft one. */
  qualified: number;
  verdict: VarianceVerdict;
  /** Set only when the verdict is "uniform": the value every responding provider gave. */
  uniformValue?: CapabilityValue;
}

function emptyCounts(): Record<CapabilityValue, number> {
  return { yes: 0, no: 0, conditional: 0, unknown: 0 };
}

/**
 * Determines whether one capability actually varies across the providers that answered.
 * Providers that left the cell blank are counted as "unknown" and excluded from the verdict —
 * silence is not evidence of absence.
 */
export function computeCapabilityVariance(
  capabilityId: string,
  profiles: AgencyCapabilityProfile[],
): CapabilityVariance {
  const counts = emptyCounts();
  const distinct = new Set<CapabilityValue>();
  let qualified = 0;

  for (const profile of profiles) {
    const entry = profile.capabilities.find((c) => c.capabilityId === capabilityId);
    const value: CapabilityValue = entry?.value ?? "unknown";
    counts[value] += 1;
    if (ANSWERED_VALUES.includes(value)) {
      distinct.add(value);
      if (entry?.qualifier !== undefined) {
        qualified += 1;
      }
    }
  }

  const answered = ANSWERED_VALUES.reduce((total, value) => total + counts[value], 0);

  if (answered < MIN_RESPONSES_FOR_VERDICT) {
    return { capabilityId, counts, answered, qualified, verdict: "insufficient_data" };
  }
  if (distinct.size > 1) {
    return { capabilityId, counts, answered, qualified, verdict: "varies" };
  }

  const [uniformValue] = [...distinct];
  if (uniformValue === undefined) {
    throw new Error(`Internal error: ${String(answered)} answers but no distinct value`);
  }
  return { capabilityId, counts, answered, qualified, verdict: "uniform", uniformValue };
}

export type QuestionCapabilityVerdict = "differentiating" | "uniform" | "insufficient_data";

export interface QuestionCapabilityInsight {
  links: QuestionCapabilityLink[];
  variances: CapabilityVariance[];
  verdict: QuestionCapabilityVerdict;
  /** Ride providers currently asking this question, out of all ride providers on the roster. */
  askedByProviderCount: number;
  totalProviderCount: number;
  /**
   * True when the capability behind this question differs between providers *and* most providers
   * do not currently ask it — the strongest case for adding a question to a unified intake,
   * since the agencies not asking still need the answer to route the rider.
   */
  unifiedIntakeCandidate: boolean;
}

export function isRideProvider(agency: Agency): boolean {
  return agency.kind === "ride_provider";
}

/**
 * Combines the editorial question → capability map with the variance analysis to say what a
 * given intake question is actually determining, and whether that determination distinguishes
 * one provider from another.
 */
export function computeQuestionCapabilityInsight(
  question: IntakeQuestion,
  links: QuestionCapabilityLink[],
  profiles: AgencyCapabilityProfile[],
  rideProviderIds: Set<string>,
): QuestionCapabilityInsight {
  const variances = links.map((link) => computeCapabilityVariance(link.capabilityId, profiles));

  let verdict: QuestionCapabilityVerdict;
  if (variances.some((v) => v.verdict === "varies")) {
    verdict = "differentiating";
  } else if (variances.some((v) => v.verdict === "uniform")) {
    verdict = "uniform";
  } else {
    verdict = "insufficient_data";
  }

  const askingProviders = new Set(
    question.requirements
      .map((requirement) => requirement.agencyId)
      .filter((agencyId) => rideProviderIds.has(agencyId)),
  );

  const askedByProviderCount = askingProviders.size;
  const totalProviderCount = rideProviderIds.size;

  return {
    links,
    variances,
    verdict,
    askedByProviderCount,
    totalProviderCount,
    // "Most providers do not ask it": strictly fewer than half.
    unifiedIntakeCandidate:
      verdict === "differentiating" && askedByProviderCount * 2 < totalProviderCount,
  };
}

export type CoverageStatus =
  | "reported" // has a row and answered at least one column
  | "surveyed_no_answers" // has a row, every column blank
  | "not_surveyed" // ride provider with no row at all
  | "not_applicable"; // fare or travel-training program — vehicle capabilities do not apply

export interface AgencyCoverage {
  agencyId: string;
  status: CoverageStatus;
  /** True when the agency reports capabilities but asks no intake questions in the active dataset. */
  missingIntakeData: boolean;
}

/**
 * Per-agency reporting completeness, for the coverage view. Distinguishing "returned a blank
 * survey" from "was never surveyed" from "the question does not apply to this kind of agency"
 * is the whole point — collapsing them would misrepresent three different situations as one gap.
 */
export function computeCoverage(
  agencies: Agency[],
  profiles: AgencyCapabilityProfile[],
  questions: IntakeQuestion[],
): AgencyCoverage[] {
  const profileByAgency = new Map(profiles.map((profile) => [profile.agencyId, profile]));
  const agenciesWithQuestions = new Set(
    questions.flatMap((question) => question.requirements.map((r) => r.agencyId)),
  );

  return agencies.map((agency) => {
    const profile = profileByAgency.get(agency.id);
    let status: CoverageStatus;
    if (profile) {
      status = profile.capabilities.some((c) => c.value !== "unknown")
        ? "reported"
        : "surveyed_no_answers";
    } else if (isRideProvider(agency)) {
      status = "not_surveyed";
    } else {
      status = "not_applicable";
    }

    return {
      agencyId: agency.id,
      status,
      missingIntakeData: profile !== undefined && !agenciesWithQuestions.has(agency.id),
    };
  });
}
