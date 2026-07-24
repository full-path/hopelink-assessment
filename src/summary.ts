import type { AgencyRequirement, IntakeQuestion, RequirementLevel } from "./data/types";

/**
 * Strictness ordering used to derive each agency's single "effective posture" toward a
 * question from its (possibly multiple) requirement entries — an agency can appear in more
 * than one of the source CSV's Required/Optional/Self-Attestation/Burden-of-Proof columns
 * for the same question, and the strictest one wins for comparison purposes. Demanding
 * documentary proof is treated as the strictest posture: it implies the question is
 * mandatory *and* backed by evidence, a stronger practice than "required" alone.
 */
const STRICTNESS_ORDER: RequirementLevel[] = [
  "proof_required",
  "required",
  "self_attestation",
  "optional",
];

function effectiveLevel(requirements: AgencyRequirement[]): RequirementLevel {
  let strictest = STRICTNESS_ORDER.length - 1;
  for (const req of requirements) {
    const rank = STRICTNESS_ORDER.indexOf(req.level);
    if (rank < strictest) strictest = rank;
  }
  const level = STRICTNESS_ORDER[strictest];
  if (level === undefined) {
    throw new Error("effectiveLevel called with no requirements");
  }
  return level;
}

export type AgencyPosture =
  | { status: "compatible"; agencyId: string; level: RequirementLevel }
  | {
      status: "needs_change";
      agencyId: string;
      currentLevel: RequirementLevel;
      proposedLevel: RequirementLevel;
    }
  | { status: "not_asked"; agencyId: string };

export interface QuestionSummary {
  proposedLevel: RequirementLevel;
  postures: AgencyPosture[];
}

/**
 * For a candidate "unified" question, proposes the requirement level most agencies already
 * use (the mode across agencies that currently ask it at all), then classifies every known
 * agency as already compatible, needing a practice change, or not currently asking it —
 * directly answering CLAUDE.md Section 5, requirement 5.
 */
export function computeSummary(question: IntakeQuestion, allAgencyIds: string[]): QuestionSummary {
  const requirementsByAgency = new Map<string, AgencyRequirement[]>();
  for (const req of question.requirements) {
    const existing = requirementsByAgency.get(req.agencyId);
    if (existing) {
      existing.push(req);
    } else {
      requirementsByAgency.set(req.agencyId, [req]);
    }
  }

  const levelCounts = new Map<RequirementLevel, number>();
  for (const reqs of requirementsByAgency.values()) {
    const level = effectiveLevel(reqs);
    levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
  }

  let proposedLevel: RequirementLevel = "required";
  let bestCount = -1;
  for (const level of STRICTNESS_ORDER) {
    const count = levelCounts.get(level) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      proposedLevel = level;
    }
  }

  const postures: AgencyPosture[] = allAgencyIds.map((agencyId) => {
    const reqs = requirementsByAgency.get(agencyId);
    if (!reqs || reqs.length === 0) {
      return { status: "not_asked", agencyId };
    }
    const currentLevel = effectiveLevel(reqs);
    if (currentLevel === proposedLevel) {
      return { status: "compatible", agencyId, level: currentLevel };
    }
    return { status: "needs_change", agencyId, currentLevel, proposedLevel };
  });

  return { proposedLevel, postures };
}
