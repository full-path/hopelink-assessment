import { h } from "../dom";

export type ViewId = "questions" | "capabilities";

const TABS: { id: ViewId; label: string }[] = [
  { id: "questions", label: "Intake questions" },
  { id: "capabilities", label: "Provider capabilities" },
];

export const VIEW_IDS: ViewId[] = TABS.map((tab) => tab.id);

/**
 * Two-view switcher implemented as an ARIA tablist: roving tabindex, arrow/Home/End keys, and
 * `aria-controls` pointing at the panel each tab reveals. This is a hand-rolled tab widget
 * rather than a routing library on purpose (CLAUDE.md Section 6) — with two views and no
 * deep-linking requirement, the keyboard contract is the only part that needs real care.
 */
export function renderViewTabs(active: ViewId, onSelect: (view: ViewId) => void): HTMLElement {
  const buttons = TABS.map((tab) => {
    const isActive = tab.id === active;
    return h(
      "button",
      {
        type: "button",
        role: "tab",
        id: `tab-${tab.id}`,
        "aria-selected": isActive ? "true" : "false",
        "aria-controls": `panel-${tab.id}`,
        // Roving tabindex: only the selected tab is in the tab order; the rest are reached
        // with arrow keys, per the ARIA tabs pattern.
        tabindex: isActive ? "0" : "-1",
        className: `view-tab${isActive ? " view-tab--active" : ""}`,
        onClick: () => {
          onSelect(tab.id);
        },
      },
      tab.label,
    );
  });

  const tablist = h(
    "div",
    {
      role: "tablist",
      "aria-label": "Explorer views",
      className: "view-tabs",
      onKeyDown: (event: Event) => {
        const key = (event as KeyboardEvent).key;
        const current = TABS.findIndex((tab) => tab.id === active);
        let next: number | null = null;
        if (key === "ArrowRight") next = (current + 1) % TABS.length;
        else if (key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
        else if (key === "Home") next = 0;
        else if (key === "End") next = TABS.length - 1;
        if (next === null) return;

        event.preventDefault();
        const tab = TABS[next];
        if (tab) onSelect(tab.id);
      },
    },
    ...buttons,
  );

  return tablist;
}

/** Focuses the selected tab after a re-render, so keyboard navigation doesn't lose its place. */
export function focusActiveTab(active: ViewId): void {
  document.querySelector<HTMLButtonElement>(`#tab-${active}`)?.focus();
}
