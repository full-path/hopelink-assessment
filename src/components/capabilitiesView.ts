import { h } from "../dom";
import type { Agency, AgencyCapabilityProfile, Capability, IntakeQuestion } from "../data/types";
import {
  computeCapabilityVariance,
  computeCoverage,
  type CoverageStatus,
  type VarianceVerdict,
} from "../capabilities";
import { VARIANCE_LABELS, renderCapabilityValue } from "./capabilityFormat";

export interface CapabilitiesViewProps {
  agencies: Agency[];
  questions: IntakeQuestion[];
  capabilities: Capability[];
  /** Pre-sorted for stable display order. */
  profiles: AgencyCapabilityProfile[];
  /** Map entries whose question text matched nothing in the active dataset. */
  unmatchedLinkTexts: string[];
}

const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  reported: "Reported capabilities",
  surveyed_no_answers: "Surveyed, returned no answers",
  not_surveyed: "Not surveyed",
  not_applicable: "Not applicable — no vehicles operated",
};

/** Sort order for the variance list: the capabilities that discriminate are the interesting ones. */
const VERDICT_ORDER: VarianceVerdict[] = ["varies", "uniform", "insufficient_data"];

function agencyName(agencyById: Map<string, Agency>, agencyId: string): string {
  return agencyById.get(agencyId)?.displayName ?? agencyId;
}

/**
 * "What actually differs between providers" — the headline of this view. A capability every
 * provider offers cannot route a rider anywhere, so asking about it in a unified intake buys
 * nothing; one that varies is the reason an intake question would exist at all.
 */
function renderVarianceSection(props: CapabilitiesViewProps): HTMLElement {
  const variances = props.capabilities
    .map((capability) => ({
      capability,
      variance: computeCapabilityVariance(capability.id, props.profiles),
    }))
    .sort(
      (a, b) =>
        VERDICT_ORDER.indexOf(a.variance.verdict) - VERDICT_ORDER.indexOf(b.variance.verdict),
    );

  return h(
    "section",
    { className: "cap-section", "aria-labelledby": "cap-variance-heading" },
    h("h3", { id: "cap-variance-heading" }, "What differs between providers"),
    h(
      "p",
      { className: "cap-section__intro" },
      "A capability that every provider offers equally cannot distinguish one provider from " +
        "another, so an intake question about it does no routing work. The ones that vary are " +
        "where a shared question earns its place.",
    ),
    h(
      "ul",
      { className: "cap-variance-list" },
      ...variances.map(({ capability, variance }) =>
        h(
          "li",
          { className: `cap-variance cap-variance--${variance.verdict}` },
          h("span", { className: "cap-variance__label" }, capability.label),
          h("span", { className: "cap-variance__verdict" }, VARIANCE_LABELS[variance.verdict]),
          h(
            "span",
            { className: "cap-variance__count" },
            `${String(variance.answered)} of ${String(props.profiles.length)} surveyed providers answered`,
          ),
        ),
      ),
    ),
  );
}

/** The full agency × capability matrix — the raw artifact stakeholders will want to read directly. */
function renderMatrix(props: CapabilitiesViewProps, agencyById: Map<string, Agency>): HTMLElement {
  return h(
    "section",
    { className: "cap-section", "aria-labelledby": "cap-matrix-heading" },
    h("h3", { id: "cap-matrix-heading" }, "Provider capability matrix"),
    h(
      "div",
      {
        className: "table-scroll",
        tabindex: "0",
        role: "region",
        "aria-label": "Capability matrix",
      },
      h(
        "table",
        { className: "capability-matrix" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, "Provider"),
            ...props.capabilities.map((capability) => h("th", { scope: "col" }, capability.label)),
          ),
        ),
        h(
          "tbody",
          {},
          ...props.profiles.map((profile) =>
            h(
              "tr",
              {},
              h("th", { scope: "row" }, agencyName(agencyById, profile.agencyId)),
              ...props.capabilities.map((capability) =>
                h(
                  "td",
                  {},
                  renderCapabilityValue(
                    profile.capabilities.find((c) => c.capabilityId === capability.id),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Reporting completeness. Three situations look identical in a matrix full of blanks —
 * an agency that was never surveyed, one that was surveyed and answered nothing, and one for
 * which the whole question is a category error — so they are named separately here.
 */
function renderCoverageSection(
  props: CapabilitiesViewProps,
  agencyById: Map<string, Agency>,
): HTMLElement {
  const coverage = computeCoverage(props.agencies, props.profiles, props.questions);

  return h(
    "section",
    { className: "cap-section", "aria-labelledby": "cap-coverage-heading" },
    h("h3", { id: "cap-coverage-heading" }, "Reporting coverage"),
    h(
      "p",
      { className: "cap-section__intro" },
      "A blank cell in the matrix above is not a 'no'. This table separates the agencies that " +
        "answered from those that were surveyed and did not, those never surveyed, and the fare " +
        "and travel-training programs that operate no vehicles.",
    ),
    h(
      "table",
      { className: "coverage-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, "Agency"),
          h("th", { scope: "col" }, "Capability data"),
          h("th", { scope: "col" }, "Intake data"),
        ),
      ),
      h(
        "tbody",
        {},
        ...coverage.map((entry) =>
          h(
            "tr",
            { className: `coverage-row coverage-row--${entry.status}` },
            h("th", { scope: "row" }, agencyName(agencyById, entry.agencyId)),
            h("td", {}, COVERAGE_LABELS[entry.status]),
            h(
              "td",
              {},
              entry.missingIntakeData
                ? h(
                    "span",
                    { className: "badge badge--warning" },
                    "Reports capabilities but asks no recorded intake questions",
                  )
                : "—",
            ),
          ),
        ),
      ),
    ),
  );
}

export function renderCapabilitiesView(props: CapabilitiesViewProps): HTMLElement {
  const agencyById = new Map(props.agencies.map((agency) => [agency.id, agency]));

  return h(
    "div",
    { className: "capabilities-view" },
    h(
      "p",
      { className: "view-intro" },
      "What each provider can physically accommodate, from ",
      h("code", {}, "data/capabilities.csv"),
      ". Intake questions exist to match a rider to these capabilities, so this is the other " +
        "half of the standardization argument: it shows which questions are doing real work.",
    ),
    props.unmatchedLinkTexts.length > 0
      ? h(
          "div",
          { className: "notice notice--warning", role: "status" },
          h("strong", {}, "Unmatched question links: "),
          `the question/capability map references ${String(props.unmatchedLinkTexts.length)} ` +
            `question(s) that do not exist in the dataset currently displayed — ` +
            `${props.unmatchedLinkTexts.map((text) => `"${text}"`).join(", ")}. ` +
            "Those links are not shown on any question.",
        )
      : undefined,
    renderVarianceSection(props),
    renderMatrix(props, agencyById),
    renderCoverageSection(props, agencyById),
  );
}
