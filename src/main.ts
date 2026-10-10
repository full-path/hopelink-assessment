import "./styles/main.css";
import bundledData from "./data/questions.json";
import bundledCapabilities from "./data/capabilities.json";
import type { Agency, CapabilityData, IntakeQuestion, NormalizedData } from "./data/types";
import type { Dataset } from "./data/dataset";
import { assembleQuestionUpload, normalizeQuestions } from "./data/normalize";
import { resolveQuestionCapabilityLinks } from "./data/normalizeCapabilities";
import { computeQuestionCapabilityInsight, isRideProvider } from "./capabilities";
import { h, clear } from "./dom";
import { renderDataSourceBar, type DataSource } from "./components/dataSourceBar";
import { renderSheetStatus, type SheetState } from "./components/sheetStatus";
import { loadSheetDataset, readSheetConfig } from "./sheetSource";
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

/**
 * The snapshot compiled into the bundle from `/data` at build time. It is what the page paints
 * first, with no network wait, and what it keeps showing if the live sheet is unset, unreachable
 * or invalid. See `loadSheet` for how the live data takes over.
 */
const SNAPSHOT: Dataset = {
  data: bundledData as NormalizedData,
  capabilities: bundledCapabilities as CapabilityData,
};
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
 * Whether to show the "Preview replacement CSVs" control.
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

/**
 * The published Google Sheet, if one is configured. Unset is a supported build: the app shows
 * the snapshot and makes no request for data, exactly as before the sheet existed.
 */
const sheetConfig = readSheetConfig(import.meta.env);

/**
 * The dataset an upload preview resets to: the snapshot until the live sheet has been applied,
 * the sheet after. Upload replaces the questions only, so capabilities always come from here.
 */
let base: { dataset: Dataset; source: DataSource } = {
  dataset: SNAPSHOT,
  source: { kind: "bundled" },
};
let data: NormalizedData = SNAPSHOT.data;
let capabilities: CapabilityData = SNAPSHOT.capabilities;
let source: DataSource = base.source;
let sheetState: SheetState =
  sheetConfig.status === "enabled"
    ? { status: "loading" }
    : sheetConfig.status === "misconfigured"
      ? { status: "error", message: sheetConfig.message }
      : { status: "disabled" };
/** The status line on screen, kept so it can be updated without re-rendering the page. */
let sheetStatusEl: ChildNode | null = null;
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

async function handleUpload(files: File[]): Promise<void> {
  try {
    const uploaded = await Promise.all(
      files.map(async (file) => ({ name: file.name, text: await file.text() })),
    );
    setData(normalizeQuestions(assembleQuestionUpload(uploaded), base.dataset.data.agencies), {
      kind: "uploaded",
      fileName: uploaded.map((file) => file.name).join(", "),
    });
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
 * Fetches the live sheet after first paint and decides what to do with it.
 *
 * The page never waits on this: the snapshot is already on screen, and a slow, dead or invalid
 * sheet leaves it there with the reason stated. What happens on success depends on whether the
 * sheet differs from the snapshot and on what the reader is doing:
 *
 *  - Identical (the snapshot is current): only the status line changes.
 *  - Different, reader idle: applied at once. This is the usual case, since the sheet answers
 *    within a second or two of load.
 *  - Different, reader busy (a card open, or focus inside the app — typing a comment, using a
 *    filter): offered behind a button instead. `render()` rebuilds the page, so applying it
 *    unasked would collapse the card being read and discard a half-written comment.
 */
async function loadSheet(): Promise<void> {
  if (sheetConfig.status !== "enabled") return;
  try {
    const dataset = await loadSheetDataset(sheetConfig.urls);
    if (JSON.stringify(dataset) === JSON.stringify(SNAPSHOT)) {
      // Same data, now known to be live; nothing on screen needs rebuilding to say so.
      base = { ...base, source: { kind: "sheet" } };
      if (source.kind !== "uploaded") source = base.source;
      sheetState = { status: "live", checkedAt: new Date() };
      updateSheetStatus();
    } else if (readerIsBusy()) {
      sheetState = { status: "pending", dataset };
      updateSheetStatus();
    } else {
      applySheet(dataset);
    }
  } catch (error) {
    sheetState = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    updateSheetStatus();
  }
}

function readerIsBusy(): boolean {
  const app = document.querySelector("#app");
  if (!app) return false;
  const focused = document.activeElement;
  return app.querySelector("details[open]") !== null || (focused !== null && app.contains(focused));
}

/**
 * Makes the sheet the displayed dataset and the new reset target. Unlike `setData`, filters are
 * kept — the reader chose them, and a data refresh is no reason to discard that — minus any
 * agency the sheet's roster no longer has. An upload preview in progress is left on screen; the
 * sheet becomes what "reset" returns to.
 */
function applySheet(dataset: Dataset): void {
  base = { dataset, source: { kind: "sheet" } };
  capabilities = dataset.capabilities;
  if (source.kind !== "uploaded") {
    data = dataset.data;
    source = base.source;
    const known = new Set(data.agencies.map((agency) => agency.id));
    state = { ...state, agencyIds: state.agencyIds.filter((id) => known.has(id)) };
  }
  sheetState = { status: "live", checkedAt: new Date() };
  render();
}

function updateSheetStatus(): void {
  const next = renderSheetStatus(sheetState, applyPendingSheet);
  sheetStatusEl?.replaceWith(next);
  sheetStatusEl = next;
}

function applyPendingSheet(): void {
  if (sheetState.status === "pending") applySheet(sheetState.dataset);
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
 * The question/capability map is resolved here, against the displayed question set, rather than
 * at build time, so an uploaded preview that drops a question simply loses the links it no longer
 * matches instead of rendering stale ones. Capability data itself
 * comes from the base dataset (snapshot or live sheet) — upload replaces the questions only.
 */
function buildCapabilityContext(
  questions: IntakeQuestion[],
  agencies: Agency[],
  agencyById: Map<string, Agency>,
): { context: CapabilityContext; unmatchedQuestionIds: string[] } {
  const { byQuestionId, unmatched } = resolveQuestionCapabilityLinks(
    capabilities.questionLinks,
    questions,
  );

  const profiles = [...capabilities.profiles].sort((a, b) =>
    (agencyById.get(a.agencyId)?.displayName ?? a.agencyId).localeCompare(
      agencyById.get(b.agencyId)?.displayName ?? b.agencyId,
    ),
  );

  return {
    context: {
      capabilityById: new Map(capabilities.capabilities.map((c) => [c.id, c])),
      agencyById,
      profiles,
      linksByQuestionId: byQuestionId,
      rideProviderIds: new Set(agencies.filter(isRideProvider).map((agency) => agency.id)),
    },
    unmatchedQuestionIds: [...new Set(unmatched.map((link) => link.questionId))],
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

  const { context, unmatchedQuestionIds } = buildCapabilityContext(questions, agencies, agencyById);

  const comments: CommentContext = {
    state: commentState,
    resolved: resolveComments(commentState.status === "ready" ? commentState.comments : [], {
      questionIds: new Set(questions.map((question) => question.id)),
      capabilityIds: new Set(capabilities.capabilities.map((capability) => capability.id)),
    }),
    client: commentsClient,
    onPosted: recordPostedComment,
  };

  const dataSourceEl = renderDataSourceBar({
    source,
    error: uploadError,
    onUpload: (files) => void handleUpload(files),
    onReset: () => {
      setData(base.dataset.data, base.source);
    },
  });

  const sheetStatus = renderSheetStatus(sheetState, applyPendingSheet);
  sheetStatusEl = sheetStatus;

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
          capabilities: capabilities.capabilities,
          profiles: context.profiles,
          unmatchedQuestionIds,
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
    sheetStatus,
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
void loadSheet();
