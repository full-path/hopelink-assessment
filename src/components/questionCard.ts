import { h } from "../dom";
import type { Agency, IntakeQuestion } from "../data/types";
import { LEVEL_LABELS } from "./filters";
import { computeSummary } from "../summary";

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

function renderSummary(question: IntakeQuestion, agencyById: Map<string, Agency>) {
  const summary = computeSummary(question, [...agencyById.keys()]);

  const groups: { label: string; className: string; text: (agencyId: string) => string }[] = [
    {
      label: "Already compatible",
      className: "posture--compatible",
      text: (id) => agencyName(agencyById, id),
    },
    {
      label: "Would need to change practice",
      className: "posture--needs-change",
      text: (id) => agencyName(agencyById, id),
    },
    {
      label: "Does not currently ask this question",
      className: "posture--not-asked",
      text: (id) => agencyName(agencyById, id),
    },
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
            return h("li", {}, group.text(p.agencyId));
          }),
        ),
      );
    }),
  );
}

export function renderQuestionCard(
  question: IntakeQuestion,
  agencyById: Map<string, Agency>,
  questionById: Map<string, IntakeQuestion>,
): HTMLElement {
  const hasUnresolved = (question.unresolvedLinks?.length ?? 0) > 0;

  return h(
    "details",
    { className: "question-card", id: `question-${question.id}` },
    h(
      "summary",
      { className: "question-card__summary" },
      h("span", { className: "question-card__text" }, question.text),
      hasUnresolved
        ? h("span", { className: "badge badge--warning" }, "Unresolved link")
        : undefined,
      question.dataQualityNote
        ? h("span", { className: "badge badge--note" }, "Data quality note")
        : undefined,
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
      renderSummary(question, agencyById),
    ),
  );
}
