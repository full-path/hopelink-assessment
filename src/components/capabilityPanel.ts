import { h } from "../dom";
import type {
  Agency,
  AgencyCapabilityProfile,
  Capability,
  IntakeQuestion,
  QuestionCapabilityLink,
} from "../data/types";
import { computeQuestionCapabilityInsight, type CapabilityVariance } from "../capabilities";
import {
  QUESTION_VERDICT_LABELS,
  VARIANCE_LABELS,
  renderCapabilityValue,
} from "./capabilityFormat";

/** Everything the question card needs to say what a question determines about a provider. */
export interface CapabilityContext {
  capabilityById: Map<string, Capability>;
  agencyById: Map<string, Agency>;
  /** Capability profiles, pre-sorted for stable display order. */
  profiles: AgencyCapabilityProfile[];
  linksByQuestionId: Map<string, QuestionCapabilityLink[]>;
  rideProviderIds: Set<string>;
}

function agencyName(context: CapabilityContext, agencyId: string): string {
  return context.agencyById.get(agencyId)?.displayName ?? agencyId;
}

/** Lists each provider's answer for one capability, naming those that gave none as a count. */
function renderAnswers(variance: CapabilityVariance, context: CapabilityContext): HTMLElement {
  const answered = context.profiles.filter((profile) => {
    const entry = profile.capabilities.find((c) => c.capabilityId === variance.capabilityId);
    return entry !== undefined && entry.value !== "unknown";
  });

  const silentCount = variance.counts.unknown;

  return h(
    "ul",
    { className: "cap-answers" },
    ...answered.map((profile) =>
      h(
        "li",
        {},
        h(
          "span",
          { className: "cap-answers__agency" },
          `${agencyName(context, profile.agencyId)}: `,
        ),
        renderCapabilityValue(
          profile.capabilities.find((c) => c.capabilityId === variance.capabilityId),
        ),
      ),
    ),
    silentCount > 0
      ? h(
          "li",
          { className: "cap-answers__silent" },
          `${String(silentCount)} surveyed provider${silentCount === 1 ? "" : "s"} gave no answer`,
        )
      : undefined,
  );
}

/**
 * The per-question capability block: what the question is understood to be determining, and
 * whether that determination actually distinguishes one provider from another.
 *
 * Returns null for questions the editorial map does not link to any capability — most of them.
 */
export function renderCapabilityPanel(
  question: IntakeQuestion,
  context: CapabilityContext,
): HTMLElement | null {
  const links = context.linksByQuestionId.get(question.id);
  if (!links || links.length === 0) {
    return null;
  }

  const insight = computeQuestionCapabilityInsight(
    question,
    links,
    context.profiles,
    context.rideProviderIds,
  );

  const capabilityLabel = (capabilityId: string): string =>
    context.capabilityById.get(capabilityId)?.label ?? capabilityId;

  const notes = links.filter((link) => link.note !== undefined);

  return h(
    "div",
    { className: "capability-panel" },
    h("h4", {}, "What this question determines"),
    h(
      "p",
      { className: "capability-panel__verdict" },
      h(
        "span",
        { className: `badge badge--verdict-${insight.verdict}` },
        QUESTION_VERDICT_LABELS[insight.verdict],
      ),
      insight.unifiedIntakeCandidate
        ? h("span", { className: "badge badge--candidate" }, "Unified intake candidate")
        : undefined,
    ),
    h(
      "p",
      { className: "capability-panel__coverage" },
      `Currently asked by ${String(insight.askedByProviderCount)} of ` +
        `${String(insight.totalProviderCount)} ride providers.`,
      insight.unifiedIntakeCandidate
        ? " The capability behind it differs between providers, so the agencies not asking it " +
            "still need the answer to route a rider correctly."
        : undefined,
    ),
    h(
      "table",
      { className: "capability-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, "Provider capability"),
          h("th", { scope: "col" }, "Across providers"),
          h("th", { scope: "col" }, "Reported answers"),
        ),
      ),
      h(
        "tbody",
        {},
        ...insight.variances.map((variance) =>
          h(
            "tr",
            {},
            h("th", { scope: "row" }, capabilityLabel(variance.capabilityId)),
            h(
              "td",
              {},
              h(
                "span",
                { className: `cap-verdict cap-verdict--${variance.verdict}` },
                VARIANCE_LABELS[variance.verdict],
              ),
              variance.verdict === "uniform" && variance.qualified > 0
                ? h(
                    "span",
                    { className: "cap-verdict__caveat" },
                    ` — but ${String(variance.qualified)} attached a condition`,
                  )
                : undefined,
            ),
            h("td", {}, renderAnswers(variance, context)),
          ),
        ),
      ),
    ),
    notes.length > 0
      ? h(
          "details",
          { className: "capability-panel__notes" },
          h("summary", {}, "How these mappings were decided"),
          h(
            "dl",
            {},
            ...notes.flatMap((link) => [
              h("dt", {}, capabilityLabel(link.capabilityId)),
              h("dd", {}, link.note ?? ""),
            ]),
          ),
        )
      : undefined,
  );
}
