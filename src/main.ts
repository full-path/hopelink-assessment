import "./styles/main.css";
import bundledData from "./data/questions.json";
import type { Agency, IntakeQuestion, NormalizedData } from "./data/types";
import { normalizeCsv } from "./data/normalize";
import { h, clear } from "./dom";
import { renderDataSourceBar, type DataSource } from "./components/dataSourceBar";
import { renderFilters, type FilterState } from "./components/filters";
import { renderQuestionCard } from "./components/questionCard";

const BUNDLED = bundledData as NormalizedData;
const DEFAULT_FILTERS: FilterState = { agencyId: "all", level: "all", onlyUnresolved: false };

let data: NormalizedData = BUNDLED;
let source: DataSource = { kind: "bundled" };
let uploadError: string | null = null;
let state: FilterState = DEFAULT_FILTERS;

function setData(next: NormalizedData, nextSource: DataSource): void {
  data = next;
  source = nextSource;
  uploadError = null;
  // Filters may reference agency ids that don't exist in the new dataset, so start clean.
  state = DEFAULT_FILTERS;
  render();
}

async function handleUpload(file: File): Promise<void> {
  try {
    const text = await file.text();
    setData(normalizeCsv(text), { kind: "uploaded", fileName: file.name });
  } catch (error) {
    // Keep whatever dataset is currently displayed; just surface why the upload failed.
    uploadError = error instanceof Error ? error.message : String(error);
    render();
  }
}

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

  const { agencies, questions } = data;
  const agencyById = new Map<string, Agency>(agencies.map((a) => [a.id, a]));
  const questionById = new Map<string, IntakeQuestion>(questions.map((q) => [q.id, q]));

  const filtered = questions.filter(questionMatches);

  const dataSourceEl = renderDataSourceBar({
    source,
    error: uploadError,
    onUpload: (file) => void handleUpload(file),
    onReset: () => {
      setData(BUNDLED, { kind: "bundled" });
    },
  });

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
    dataSourceEl,
    filtersEl,
    countEl,
    listEl,
  );
}

render();
