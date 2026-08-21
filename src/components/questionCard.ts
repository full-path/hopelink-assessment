import { h } from "../dom";
import type { Agency, IntakeQuestion } from "../data/types";
import { LEVEL_LABELS } from "./filters";
import { computeSummary } from "../summary";
import { computeQuestionCapabilityInsight } from "../capabilities";
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

function renderLinks(
  question: IntakeQuestion,
  questionById: Map<string, IntakeQuestion>,
  hasCapabilityLinks: boolean,
) {
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

  const hasUnresolved = (question.unresolvedLinks?.length ?? 0) > 0;

  return h(
    "div",
    { className: "links" },
    h("h4", {}, "Upstream / downstream"),
    h("ul", {}, ...items),
    // The intake sheet's dangling references to provider capabilities have no question to point
    // at, but they do have an answer — it just lives in a different dataset.
    hasUnresolved && hasCapabilityLinks
      ? h(
          "p",
          { className: "links__capability-hint" },
          "An unresolved reference here points at provider capability data rather than another " +
            "intake question. What this question determines about a provider is shown below.",
        )
      : undefined,
  );
}

function renderSummary(
  question: IntakeQuestion,
  agencyById: Map<string, Agency>,
  summaryAgencyIds: string[],
) {
  const summary = computeSummary(question, summaryAgencyIds);

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
    capabilityContext,
    commentContext,
  } = props;
  const commentTarget = { kind: "question", id: question.id } as const;
  // Built up front and kept current by the thread: posting updates the DOM in place rather than
  // re-rendering, so this badge would otherwise sit stale. Empty text hides it (see main.css).
  const commentBadge = commentCountBadge(commentCountFor(commentContext, commentTarget));
  const hasUnresolved = (question.unresolvedLinks?.length ?? 0) > 0;
  const capabilityLinks = capabilityContext.linksByQuestionId.get(question.id) ?? [];

  // Computed here as well as inside the panel so the collapsed card can advertise the finding
  // without the reader having to open every question to go looking for it.
  const isCandidate =
    capabilityLinks.length > 0 &&
    computeQuestionCapabilityInsight(
      question,
      capabilityLinks,
      capabilityContext.profiles,
      capabilityContext.rideProviderIds,
    ).unifiedIntakeCandidate;

  return h(
    "details",
    { className: "question-card", id: `question-${question.id}` },
    h(
      "summary",
      { className: "question-card__summary" },
      h("span", { className: "question-card__text" }, question.text),
      isCandidate
        ? h("span", { className: "badge badge--candidate" }, "Unified intake candidate")
        : undefined,
      hasUnresolved
        ? h("span", { className: "badge badge--warning" }, "Unresolved link")
        : undefined,
      question.dataQualityNote
        ? h("span", { className: "badge badge--note" }, "Data quality note")
        : undefined,
      // Surfaced on the collapsed line so a reader can see there is discussion without opening
      // all 42 cards to go looking for it.
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
      renderLinks(question, questionById, capabilityLinks.length > 0),
      renderCapabilityPanel(question, capabilityContext),
      renderSummary(question, agencyById, summaryAgencyIds),
      renderCommentThreadFor(commentContext, commentTarget, question.text, commentBadge.update),
    ),
  );
}
