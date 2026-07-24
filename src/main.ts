import "./styles/main.css";
import data from "./data/questions.json";
import type { Agency, IntakeQuestion, NormalizedData } from "./data/types";
import { h, clear } from "./dom";
import { renderFilters, type FilterState } from "./components/filters";
import { renderQuestionCard } from "./components/questionCard";

const { agencies, questions } = data as NormalizedData;

const agencyById = new Map<string, Agency>(agencies.map((a) => [a.id, a]));
const questionById = new Map<string, IntakeQuestion>(questions.map((q) => [q.id, q]));

let state: FilterState = { agencyId: "all", level: "all", onlyUnresolved: false };

function questionMatches(question: IntakeQuestion): boolean {
  if (state.onlyUnresolved && (question.unresolvedLinks?.length ?? 0) === 0) {
    return false;
  }
  if (state.agencyId !== "all" || state.level !== "all") {
    const hasMatch = question.requirements.some((req) => {
      const agencyOk = state.agencyId === "all" || req.agencyId === state.agencyId;
      const levelOk = state.level === "all" || req.level === state.level;
      return agencyOk && levelOk;
    });
    if (!hasMatch) return false;
  }
  return true;
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app root element not found");
  clear(app);

  const filtered = questions.filter(questionMatches);

  const filtersEl = renderFilters(agencies, state, (next) => {
    state = next;
    render();
  });

  const countEl = h(
    "p",
    { className: "result-count", role: "status" },
    `Showing ${String(filtered.length)} of ${String(questions.length)} questions`,
  );

  const listEl = h(
    "div",
    { className: "question-list" },
    ...(filtered.length > 0
      ? filtered.map((q) => renderQuestionCard(q, agencyById, questionById))
      : [h("p", { className: "empty-note" }, "No questions match the current filters.")]),
  );

  app.append(
    h(
      "header",
      { className: "app-header" },
      h("h1", {}, "Find a Ride — Unified Intake Explorer"),
      h(
        "p",
        {},
        "A single de-duplicated view of the intake questions asked across Central Puget Sound " +
          "specialized-transportation agencies, showing where practice already lines up and where " +
          "standardizing a question would require an agency to change what it asks for.",
      ),
    ),
    filtersEl,
    countEl,
    listEl,
  );
}

render();
