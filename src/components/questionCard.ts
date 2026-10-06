import { h } from "../dom";
import type { Agency, IntakeQuestion } from "../data/types";
import { LEVEL_LABELS } from "./filters";
import { renderAgencyStrip } from "./agencyStrip";
import { computeSummary } from "../summary";
import { renderCapabilityPanel, type CapabilityContext } from "./capabilityPanel";
import {
  commentCountBadge,
  commentCountFor,
  renderCommentThreadFor,
  type CommentContext,
} from "./commentThread";

export interface QuestionCardProps {
  question: IntakeQuestion;
  agencyById: Map<string, Agency>;
  questionById: Map<string, IntakeQuestion>;
  /**
   * The agency population the standardization summary compares against. Deliberately not the
   * whole roster: an agency that appears in no intake row at all (Community Van) would otherwise
   * be listed as "does not ask this question" on every question, which reads as a finding when
   * it is really an absence of data. The capabilities view reports that absence explicitly.
   */
  summaryAgencyIds: string[];
  /**
   * The agencies the header strip and the count badge cover — the agency filter's selection, or
   * the whole population when nothing is selected.
   *
   * Deliberately separate from `summaryAgencyIds`, which stays the full population even while a
   * filter is active. The strip is a display: narrowing it answers "how do *these* agencies
   * handle this question?". The standardization summary is an analysis: its proposed level is
   * the mode across agencies, so computing it over a hand-picked subset would produce a
   * region-wide recommendation derived from two agencies. The filter must not reach it.
   */
  stripAgencyIds: string[];
  /** Whether a selection is in force, so the count badge can say "selected" and mean it. */
  agencyFilterActive: boolean;
  capabilityContext: CapabilityContext;
  commentContext: CommentContext;
}

function agencyName(agencyById: Map<string, Agency>, agencyId: string): string {
  return agencyById.get(agencyId)?.displayName ?? agencyId;
}

function renderRequirementsTable(question: IntakeQuestion, agencyById: Map<string, Agency>) {
  if (question.requirements.length === 0) {
    return h(
      "p",
      { className: "empty-note" },
      "No agency requirements recorded for this question.",
    );
  }

  return h(
    "table",
    { className: "requirements-table" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col" }, "Agency"),
        h("th", { scope: "col" }, "Requirement level"),
        h("th", { scope: "col" }, "Proof detail"),
      ),
    ),
    h(
      "tbody",
      {},
      ...question.requirements.map((req) =>
        h(
          "tr",
          {},
          h("td", {}, agencyName(agencyById, req.agencyId)),
          h("td", {}, LEVEL_LABELS[req.level]),
          h("td", {}, req.proofDetail ?? "—"),
        ),
      ),
    ),
  );
}

function renderLinks(question: IntakeQuestion, questionById: Map<string, IntakeQuestion>) {
  const items: HTMLElement[] = [];

  for (const id of question.upstreamRefs) {
    items.push(
      h(
        "li",
        { className: "link-item link-item--resolved" },
        "Upstream: ",
        h("a", { href: `#question-${id}` }, questionById.get(id)?.text ?? id),
      ),
    );
  }
  for (const id of question.downstreamRefs) {
    items.push(
      h(
        "li",
        { className: "link-item link-item--resolved" },
        "Downstream: ",
        h("a", { href: `#question-${id}` }, questionById.get(id)?.text ?? id),
      ),
    );
  }
  for (const raw of question.unresolvedLinks ?? []) {
    items.push(
      h(
        "li",
        { className: "link-item link-item--unresolved" },
        h("span", { className: "badge badge--warning" }, "Unresolved"),
        ` "${raw}" could not be matched to a question.`,
      ),
    );
  }

  if (items.length === 0) {
    return null;
  }

  return h(
    "div",
    { className: "links" },
    h("h4", {}, "Upstream / downstream"),
    h("ul", {}, ...items),
  );
}

function renderSummary(
  question: IntakeQuestion,
  agencyById: Map<string, Agency>,
  summaryAgencyIds: string[],
) {
  const summary = computeSummary(question, summaryAgencyIds);

  // No agency reported a practice for this question, so there is no mode to propose. Saying so
  // is the point: inventing a level from an empty set would read as a finding.
  if (summary.proposedLevel === null) {
    return h(
      "div",
      { className: "summary" },
      h("h4", {}, "Standardization summary"),
      h(
        "p",
        { className: "empty-note" },
        "No agency has a recorded practice for this question, so there is no basis for " +
          "proposing a unified requirement level.",
      ),
    );
  }

  const groups: { label: string; className: string }[] = [
    { label: "Already compatible", className: "posture--compatible" },
    { label: "Would need to change practice", className: "posture--needs-change" },
    { label: "Does not currently ask this question", className: "posture--not-asked" },
  ];

  const compatible = summary.postures.filter((p) => p.status === "compatible");
  const needsChange = summary.postures.filter((p) => p.status === "needs_change");
  const notAsked = summary.postures.filter((p) => p.status === "not_asked");
  const buckets = [compatible, needsChange, notAsked];

  return h(
    "div",
    { className: "summary" },
    h("h4", {}, "Standardization summary"),
    h(
      "p",
      {},
      "Proposed unified requirement level: ",
      h("strong", {}, LEVEL_LABELS[summary.proposedLevel]),
    ),
    ...groups.map((group, i) => {
      const bucket = buckets[i];
      if (!bucket || bucket.length === 0) return null;
      return h(
        "div",
        { className: `posture-group ${group.className}` },
        h("h5", {}, `${group.label} (${String(bucket.length)})`),
        h(
          "ul",
          {},
          ...bucket.map((p) => {
            if (p.status === "needs_change") {
              return h(
                "li",
                {},
                `${agencyName(agencyById, p.agencyId)} — currently ${LEVEL_LABELS[p.currentLevel]}`,
              );
            }
            return h("li", {}, agencyName(agencyById, p.agencyId));
          }),
        ),
      );
    }),
  );
}

export function renderQuestionCard(props: QuestionCardProps): HTMLElement {
  const {
    question,
    agencyById,
    questionById,
    summaryAgencyIds,
    stripAgencyIds,
    agencyFilterActive,
    capabilityContext,
    commentContext,
  } = props;
  const commentTarget = { kind: "question", id: question.id } as const;
  // Built up front and kept current by the thread: posting updates the DOM in place rather than
  // re-rendering, so this badge would otherwise sit stale. Empty text hides it (see main.css).
  const commentBadge = commentCountBadge(commentCountFor(commentContext, commentTarget));
  const hasUnresolved = (question.unresolvedLinks?.length ?? 0) > 0;

  /**
   * How many agencies ask this question in any form.
   *
   * Distinct agencies, not requirement entries: an agency can appear in several of the source
   * CSV's columns for the same question (required *and* self-attestation, say), and that is one
   * agency asking, not two.
   *
   * Counted over `stripAgencyIds` so the number and the boxes beside it always describe the same
   * population — a badge reading "7 of 16" next to three boxes would be two answers to one
   * question.
   */
  const stripAgencies = new Set(stripAgencyIds);
  const askingAgencyCount = new Set(
    question.requirements.map((r) => r.agencyId).filter((id) => stripAgencies.has(id)),
  ).size;

  return h(
    "details",
    { className: "question-card", id: `question-${question.id}` },
    h(
      "summary",
      { className: "question-card__summary" },
      h("span", { className: "question-card__text" }, question.text),
      // Self-describing rather than a bare "7 of 16": the badge is read out of context both by
      // a screen reader and by someone scanning 43 collapsed rows.
      h(
        "span",
        { className: "badge badge--agency-count" },
        `Asked by ${String(askingAgencyCount)} of ${String(stripAgencyIds.length)} ` +
          (agencyFilterActive ? "selected agencies" : "agencies"),
      ),
      renderAgencyStrip({ question, agencyById, agencyIds: stripAgencyIds }),
      hasUnresolved
        ? h("span", { className: "badge badge--warning" }, "Unresolved link")
        : undefined,
      // Surfaced on the collapsed line so a reader can see there is discussion without opening
      // every card to go looking for it.
      commentBadge.element,
    ),
    h(
      "div",
      { className: "question-card__body" },
      question.dataQualityNote
        ? h(
            "p",
            { className: "data-quality-note" },
            h("strong", {}, "Data quality note: "),
            question.dataQualityNote,
          )
        : undefined,
      renderRequirementsTable(question, agencyById),
      renderLinks(question, questionById),
      renderCapabilityPanel(question, capabilityContext),
      renderSummary(question, agencyById, summaryAgencyIds),
      renderCommentThreadFor(commentContext, commentTarget, question.text, commentBadge.update),
    ),
  );
}
