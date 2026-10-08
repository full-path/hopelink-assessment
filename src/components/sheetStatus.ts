import { h } from "../dom";
import type { Dataset } from "../data/dataset";

/**
 * Where the live Google Sheet has got to, as far as the reader is concerned. Rendered directly,
 * so "still checking", "showing live data", "newer data is waiting" and "fell back to the
 * snapshot, and why" are each visible — a failure to load the sheet is stated, never hidden
 * behind data that silently happens to be older.
 */
export type SheetState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "live"; checkedAt: Date }
  | { status: "pending"; dataset: Dataset }
  | { status: "error"; message: string };

/**
 * The one-line status under the page header. Returns a placeholder comment node when no sheet is
 * configured, so the caller can swap it in place either way without re-rendering the page.
 */
export function renderSheetStatus(state: SheetState, onApplyPending: () => void): ChildNode {
  switch (state.status) {
    case "disabled":
      return document.createComment("live sheet not configured");

    case "loading":
      return line("Checking the live sheet for updates…");

    case "live":
      return line(
        `Showing live data from the Google Sheet, checked at ` +
          `${state.checkedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
      );

    case "pending":
      return line(
        "The sheet has been updated since this page was published. ",
        h(
          "button",
          { type: "button", className: "sheet-status__apply", onClick: onApplyPending },
          "Show the latest data",
        ),
      );

    case "error":
      return h(
        "div",
        { className: "sheet-status sheet-status--error", role: "status" },
        h(
          "strong",
          {},
          "Showing data as of the last site build — the live sheet could not be used. ",
        ),
        state.message,
      );
  }
}

function line(...children: (Node | string)[]): HTMLElement {
  return h("p", { className: "sheet-status", role: "status" }, ...children);
}
