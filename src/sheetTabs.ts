import type { SourceTexts } from "./data/dataset";

/**
 * The live sheet's tabs: what each is called, and its `gid` — the number after `#gid=` in the
 * address bar when the tab is open in Google Sheets.
 *
 * The published document's address comes from build-time env (`VITE_SHEET_PUBLISHED_URL`);
 * the gids live here, in code, because they identify the tabs of one particular spreadsheet and
 * never change while it is in use, so they belong in review rather than in deploy settings.
 * `apps-script/SheetSetup.gs` prints this block, filled in, when it creates the tabs.
 *
 * `null` means "not wired up yet": a published URL with any gid still null is reported as a
 * misconfiguration, and the page keeps showing the snapshot.
 */
export const SHEET_TABS: Record<keyof SourceTexts, { name: string; gid: number | null }> = {
  agencies: { name: "Agencies", gid: null },
  agencyGroups: { name: "Agency groups", gid: null },
  questions: { name: "Questions", gid: null },
  requirements: { name: "Requirements", gid: null },
  questionLinks: { name: "Question links", gid: null },
  capabilities: { name: "Capabilities", gid: null },
  providerCapabilities: { name: "Provider capabilities", gid: null },
  capabilityMap: { name: "Question-capability map", gid: null },
};
