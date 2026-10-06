import { h } from "../dom";
import type { Agency, IntakeQuestion, RequirementLevel } from "../data/types";
import { effectiveLevelByAgency } from "../summary";
import { LEVEL_LABELS } from "./filters";

/**
 * One small box per agency, in the question header: at a glance, who asks this question and how
 * strictly.
 *
 * Box position maps to the same agency on every card — the caller passes one shared, stably
 * ordered id list — so the strips line up into columns down the list and a reader can scan
 * vertically for an agency's pattern across all questions. Reordering that list per card would
 * destroy the only thing this component is for.
 *
 * Colour encodes strictness as a sequential ramp rather than five unrelated hues, because the
 * levels are ordered (proof required > required > self-attestation > optional) and a ramp reads
 * as density. "Not asked" sits outside the ramp as a faint neutral.
 */

/** Ramp order, strictest first. Also the legend's order. */
const LEVELS_BY_STRICTNESS: RequirementLevel[] = [
  "proof_required",
  "required",
  "self_attestation",
  "optional",
];

/** Class suffix for an agency with no requirement recorded for the question. */
const NOT_ASKED = "not-asked";

const NOT_ASKED_LABEL = "Not asked";

export interface AgencyStripProps {
  question: IntakeQuestion;
  agencyById: Map<string, Agency>;
  /** The full agency population, in a stable order shared by every card. */
  agencyIds: string[];
}

function agencyName(agencyById: Map<string, Agency>, agencyId: string): string {
  return agencyById.get(agencyId)?.displayName ?? agencyId;
}

/** Every proof detail this agency recorded for this question, in source order. */
function proofDetailsFor(question: IntakeQuestion, agencyId: string): string[] {
  return question.requirements.flatMap((req) =>
    req.agencyId === agencyId && req.proofDetail !== undefined ? [req.proofDetail] : [],
  );
}

/**
 * Mouse-over text for one box. A `title` is used rather than a custom tooltip because the strip
 * lives inside a <summary>: anything focusable here would add 16 tab stops per card, and there
 * are dozens of cards. The authoritative per-agency breakdown is the requirements table in the
 * card body, which is what assistive technology and keyboard users get.
 */
function boxTitle(
  question: IntakeQuestion,
  agencyById: Map<string, Agency>,
  agencyId: string,
  level: RequirementLevel | undefined,
): string {
  const name = agencyName(agencyById, agencyId);
  if (level === undefined) {
    return `${name} — ${NOT_ASKED_LABEL}`;
  }

  const lines = [`${name} — ${LEVEL_LABELS[level]}`];
  for (const detail of proofDetailsFor(question, agencyId)) {
    lines.push(`Proof: ${detail}`);
  }
  return lines.join("\n");
}

/**
 * One sentence naming what the strip shows, so a screen reader gets a coherent summary instead
 * of sixteen unlabelled boxes. The strip is `role="img"`, which makes it a leaf — the individual
 * boxes are not announced.
 */
function stripLabel(levelByAgency: Map<string, RequirementLevel>, total: number): string {
  const counts = new Map<RequirementLevel, number>();
  for (const level of levelByAgency.values()) {
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }

  const parts = LEVELS_BY_STRICTNESS.flatMap((level) => {
    const count = counts.get(level) ?? 0;
    return count > 0 ? [`${String(count)} ${LEVEL_LABELS[level].toLowerCase()}`] : [];
  });

  const notAsked = total - levelByAgency.size;
  if (notAsked > 0) {
    parts.push(`${String(notAsked)} not asked`);
  }

  return `Requirement by agency: ${parts.join(", ")}.`;
}

export function renderAgencyStrip(props: AgencyStripProps): HTMLElement {
  const { question, agencyById, agencyIds } = props;
  const levelByAgency = effectiveLevelByAgency(question);

  return h(
    "span",
    {
      className: "agency-strip",
      role: "img",
      "aria-label": stripLabel(levelByAgency, agencyIds.length),
    },
    ...agencyIds.map((agencyId) => {
      const level = levelByAgency.get(agencyId);
      return h("span", {
        className: `agency-box agency-box--${level ?? NOT_ASKED}`,
        title: boxTitle(question, agencyById, agencyId, level),
      });
    }),
  );
}

/**
 * Key for the strip. Sixteen boxes in five colours are unreadable without one, so this is part
 * of the feature rather than a nicety — it renders once above the list.
 */
export function renderAgencyStripLegend(agencyCount: number, filtered: boolean): HTMLElement {
  const swatch = (suffix: string, label: string): HTMLElement =>
    h(
      "li",
      { className: "agency-legend__item" },
      h("span", { className: `agency-box agency-box--${suffix}`, "aria-hidden": "true" }),
      label,
    );

  return h(
    "div",
    { className: "agency-legend" },
    h(
      "p",
      { className: "agency-legend__intro" },
      filtered
        ? `Each question shows one box per selected agency, in the same order every time — ` +
            `${String(agencyCount)} of them. Hover a box for its requirement level and proof ` +
            `detail. The breakdown inside each question still covers every agency.`
        : `Each question shows one box per agency, in the same order every time — ` +
            `${String(agencyCount)} agencies. Hover a box for its requirement level and proof detail.`,
    ),
    h(
      "ul",
      { className: "agency-legend__key" },
      ...LEVELS_BY_STRICTNESS.map((level) => swatch(level, LEVEL_LABELS[level])),
      swatch(NOT_ASKED, NOT_ASKED_LABEL),
    ),
  );
}
