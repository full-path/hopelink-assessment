import "./styles/main.css";
import bundledData from "./data/questions.json";
import bundledCapabilities from "./data/capabilities.json";
import type { Agency, CapabilityData, IntakeQuestion, NormalizedData } from "./data/types";
import { normalizeCsv } from "./data/normalize";
import { resolveQuestionCapabilityLinks } from "./data/normalizeCapabilities";
import { computeQuestionCapabilityInsight, isRideProvider } from "./capabilities";
import { h, clear } from "./dom";
import { renderDataSourceBar, type DataSource } from "./components/dataSourceBar";
import { renderFilters, type FilterState } from "./components/filters";
import { renderQuestionCard } from "./components/questionCard";
import { renderCapabilitiesView } from "./components/capabilitiesView";
import { focusActiveTab, renderViewTabs, type ViewId } from "./components/viewTabs";
import type { CapabilityContext } from "./components/capabilityPanel";

const BUNDLED = bundledData as NormalizedData;
const CAPABILITIES = bundledCapabilities as CapabilityData;
const DEFAULT_FILTERS: FilterState = {
  agencyId: "all",
  level: "all",
  onlyUnresolved: false,
  capability: "all",
};

let data: NormalizedData = BUNDLED;
let source: DataSource = { kind: "bundled" };
let uploadError: string | null = null;
let state: FilterState = DEFAULT_FILTERS;
let view: ViewId = "questions";
/** Set when a re-render was triggered by keyboard tab navigation, so focus can follow the tab. */
let restoreTabFocus = false;

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

/**
 * Assembles the capability context for the currently displayed question set.
 *
 * The question/capability map is stored against question *text* and resolved here rather than
 * baked into ids at build time, so an uploaded CSV (which may rename or drop questions) simply
 * loses the links it no longer matches instead of rendering stale ones. Capability data itself
 * is always the bundled set — upload replaces the intake questions only.
 */
function buildCapabilityContext(
  questions: IntakeQuestion[],
  agencies: Agency[],
  agencyById: Map<string, Agency>,
): { context: CapabilityContext; unmatchedLinkTexts: string[] } {
  const { byQuestionId, unmatched } = resolveQuestionCapabilityLinks(
    CAPABILITIES.questionLinks,
    questions,
  );

  const profiles = [...CAPABILITIES.profiles].sort((a, b) =>
    (agencyById.get(a.agencyId)?.displayName ?? a.agencyId).localeCompare(
      agencyById.get(b.agencyId)?.displayName ?? b.agencyId,
    ),
  );

  return {
    context: {
      capabilityById: new Map(CAPABILITIES.capabilities.map((c) => [c.id, c])),
      agencyById,
      profiles,
      linksByQuestionId: byQuestionId,
      rideProviderIds: new Set(agencies.filter(isRideProvider).map((agency) => agency.id)),
    },
    unmatchedLinkTexts: [...new Set(unmatched.map((link) => link.questionText))],
  };
}

function questionMatches(question: IntakeQuestion, context: CapabilityContext): boolean {
  if (state.onlyUnresolved && (question.unresolvedLinks?.length ?? 0) === 0) {
    return false;
  }
  if (state.capability !== "all") {
    const links = context.linksByQuestionId.get(question.id) ?? [];
    if (links.length === 0) return false;
    if (
      state.capability === "candidate" &&
      !computeQuestionCapabilityInsight(question, links, context.profiles, context.rideProviderIds)
        .unifiedIntakeCandidate
    ) {
      return false;
    }
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

function renderQuestionsPanel(
  questions: IntakeQuestion[],
  agencyById: Map<string, Agency>,
  intakeAgencies: Agency[],
  context: CapabilityContext,
): HTMLElement {
  const questionById = new Map<string, IntakeQuestion>(questions.map((q) => [q.id, q]));
  const filtered = questions.filter((question) => questionMatches(question, context));
  const summaryAgencyIds = intakeAgencies.map((agency) => agency.id);

  return h(
    "div",
    {},
    renderFilters(intakeAgencies, state, (next) => {
      state = next;
      render();
    }),
    h(
      "p",
      { className: "result-count", role: "status" },
      `Showing ${String(filtered.length)} of ${String(questions.length)} questions`,
    ),
    h(
      "div",
      { className: "question-list" },
      ...(filtered.length > 0
        ? filtered.map((question) =>
            renderQuestionCard({
              question,
              agencyById,
              questionById,
              summaryAgencyIds,
              capabilityContext: context,
            }),
          )
        : [h("p", { className: "empty-note" }, "No questions match the current filters.")]),
    ),
  );
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app root element not found");
  clear(app);

  const { agencies, questions } = data;
  const agencyById = new Map<string, Agency>(agencies.map((a) => [a.id, a]));

  // Agencies that appear somewhere in the intake data — see QuestionCardProps.summaryAgencyIds.
  const agencyIdsWithIntakeData = new Set(
    questions.flatMap((question) => question.requirements.map((r) => r.agencyId)),
  );
  const intakeAgencies = agencies.filter((agency) => agencyIdsWithIntakeData.has(agency.id));

  const { context, unmatchedLinkTexts } = buildCapabilityContext(questions, agencies, agencyById);

  const dataSourceEl = renderDataSourceBar({
    source,
    error: uploadError,
    onUpload: (file) => void handleUpload(file),
    onReset: () => {
      setData(BUNDLED, { kind: "bundled" });
    },
  });

  const tabsEl = renderViewTabs(view, (next) => {
    view = next;
    restoreTabFocus = true;
    render();
  });

  const panelEl = h(
    "div",
    {
      role: "tabpanel",
      id: `panel-${view}`,
      "aria-labelledby": `tab-${view}`,
      className: "view-panel",
    },
    view === "questions"
      ? renderQuestionsPanel(questions, agencyById, intakeAgencies, context)
      : renderCapabilitiesView({
          agencies,
          questions,
          capabilities: CAPABILITIES.capabilities,
          profiles: context.profiles,
          unmatchedLinkTexts,
        }),
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
    tabsEl,
    panelEl,
  );

  if (restoreTabFocus) {
    restoreTabFocus = false;
    focusActiveTab(view);
  }
}

render();
