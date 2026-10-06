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
import { renderAgencyStripLegend } from "./components/agencyStrip";
import { renderCapabilitiesView } from "./components/capabilitiesView";
import { focusActiveTab, renderViewTabs, type ViewId } from "./components/viewTabs";
import type { CapabilityContext } from "./components/capabilityPanel";
import { createCommentsClient } from "./comments/client";
import { resolveComments } from "./comments/resolve";
import type { Comment, CommentState } from "./comments/types";
import { renderCommentOrphanNotice, type CommentContext } from "./components/commentThread";

const BUNDLED = bundledData as NormalizedData;
const CAPABILITIES = bundledCapabilities as CapabilityData;
const DEFAULT_FILTERS: FilterState = {
  agencyIds: [],
  level: "all",
  capability: "all",
};

/**
 * Null when `VITE_COMMENTS_ENDPOINT` is unset, which disables commenting without affecting
 * anything else. See `createCommentsClient` — that is a supported build, not a broken one.
 */
const commentsClient = createCommentsClient(import.meta.env.VITE_COMMENTS_ENDPOINT);

/**
 * Whether to show the "Preview a replacement CSV" control.
 *
 * Hidden for now by request. The machinery behind it is deliberately left intact and wired up —
 * `handleUpload`, `setData`, and the shared in-browser normalization path they drive — so that
 * restoring the control is this one flag rather than an archaeology exercise. Keeping the glue
 * referenced also keeps it type-checked, which is what stops it rotting while it is off.
 *
 * Off unless `VITE_SHOW_CSV_UPLOAD=true` at build time. An env flag rather than a hardcoded
 * constant so the control can be brought back for a stakeholder session without editing code,
 * and so the build is the thing that decides — the same arrangement `VITE_COMMENTS_ENDPOINT`
 * already uses.
 */
const SHOW_DATA_SOURCE_BAR = import.meta.env.VITE_SHOW_CSV_UPLOAD === "true";

let data: NormalizedData = BUNDLED;
let source: DataSource = { kind: "bundled" };
let uploadError: string | null = null;
let state: FilterState = DEFAULT_FILTERS;
let view: ViewId = "questions";
let commentState: CommentState = commentsClient ? { status: "loading" } : { status: "disabled" };
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
 * Comments arrive after first paint, so this follows the same shape as `setData`: mutate module
 * state, then re-render. The analysis renders immediately from bundled data and does not wait on
 * the network — a slow or dead comment store must never delay or blank the actual product.
 */
async function loadComments(): Promise<void> {
  if (!commentsClient) return;
  try {
    commentState = { status: "ready", comments: await commentsClient.list() };
  } catch (error) {
    commentState = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  render();
}

/**
 * Folds a just-posted comment into module state without re-rendering.
 *
 * The thread already appended it to the open <details> it lives in; a full re-render here would
 * collapse that card out from under the reader. Keeping state in step matters anyway, so the
 * comment survives the next re-render triggered by something else (a filter change, a tab switch).
 */
function recordPostedComment(comment: Comment): void {
  if (commentState.status === "ready") {
    commentState = { status: "ready", comments: [...commentState.comments, comment] };
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

function questionMatches(
  question: IntakeQuestion,
  context: CapabilityContext,
  selectedAgencyIds: Set<string>,
): boolean {
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
  if (selectedAgencyIds.size > 0 || state.level !== "all") {
    // A question survives if any single requirement satisfies both filters at once: selecting
    // two agencies and "Proof Required" means "asked with proof by either of them", not
    // "required by one and proof-demanded by the other".
    const hasMatch = question.requirements.some((req) => {
      const agencyOk = selectedAgencyIds.size === 0 || selectedAgencyIds.has(req.agencyId);
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
  comments: CommentContext,
): HTMLElement {
  const questionById = new Map<string, IntakeQuestion>(questions.map((q) => [q.id, q]));
  const summaryAgencyIds = intakeAgencies.map((agency) => agency.id);

  const selectedAgencyIds = new Set(state.agencyIds);
  const filtered = questions.filter((question) =>
    questionMatches(question, context, selectedAgencyIds),
  );

  /**
   * The agencies the header strip shows: the selection when there is one, otherwise everybody.
   *
   * Derived from the roster rather than from `state.agencyIds` directly so the order is the
   * roster's, which is what keeps box position meaning the same agency on every card. The
   * standardization summary and the requirements table deliberately keep the *full* population —
   * see the note on QuestionCardProps.stripAgencyIds.
   */
  const agencyFilterActive = selectedAgencyIds.size > 0;
  const stripAgencyIds = agencyFilterActive
    ? summaryAgencyIds.filter((id) => selectedAgencyIds.has(id))
    : summaryAgencyIds;

  return h(
    "div",
    {},
    renderCommentOrphanNotice(comments.resolved.orphansByKind.get("question") ?? [], "question"),
    renderFilters(intakeAgencies, state, (next) => {
      state = next;
      render();
    }),
    h(
      "p",
      { className: "result-count", role: "status" },
      `Showing ${String(filtered.length)} of ${String(questions.length)} questions`,
    ),
    renderAgencyStripLegend(stripAgencyIds.length, agencyFilterActive),
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
              stripAgencyIds,
              agencyFilterActive,
              capabilityContext: context,
              commentContext: comments,
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

  const comments: CommentContext = {
    state: commentState,
    resolved: resolveComments(commentState.status === "ready" ? commentState.comments : [], {
      questionIds: new Set(questions.map((question) => question.id)),
      capabilityIds: new Set(CAPABILITIES.capabilities.map((capability) => capability.id)),
    }),
    client: commentsClient,
    onPosted: recordPostedComment,
  };

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
      ? renderQuestionsPanel(questions, agencyById, intakeAgencies, context, comments)
      : renderCapabilitiesView({
          agencies,
          questions,
          capabilities: CAPABILITIES.capabilities,
          profiles: context.profiles,
          unmatchedLinkTexts,
          commentContext: comments,
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
    ...(SHOW_DATA_SOURCE_BAR ? [dataSourceEl] : []),
    tabsEl,
    panelEl,
  );

  if (restoreTabFocus) {
    restoreTabFocus = false;
    focusActiveTab(view);
  }
}

render();
void loadComments();
