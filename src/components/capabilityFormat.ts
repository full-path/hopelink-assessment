import { h } from "../dom";
import type { AgencyCapability, CapabilityValue } from "../data/types";
import type { QuestionCapabilityVerdict, VarianceVerdict } from "../capabilities";

/**
 * Shared vocabulary for displaying capability data, so the per-question panel and the
 * capabilities view label the same thing the same way.
 */

export const VALUE_LABELS: Record<CapabilityValue, string> = {
  yes: "Yes",
  no: "No",
  conditional: "Conditional",
  unknown: "No answer",
};

export const VARIANCE_LABELS: Record<VarianceVerdict, string> = {
  varies: "Varies between providers",
  uniform: "Same across all responding providers",
  insufficient_data: "Not enough responses to say",
};

export const QUESTION_VERDICT_LABELS: Record<QuestionCapabilityVerdict, string> = {
  differentiating: "Distinguishes providers",
  uniform: "Same across all responding providers",
  insufficient_data: "Not enough capability data",
};

/**
 * Renders one agency's answer. A conditional answer shows the agency's own wording rather than
 * the canonical value, because "Depends on vehicle" is the informative part; a yes/no with a
 * qualifier shows both.
 */
export function renderCapabilityValue(entry: AgencyCapability | undefined): HTMLElement {
  const value: CapabilityValue = entry?.value ?? "unknown";
  const className = `cap-value cap-value--${value}`;

  if (value === "conditional") {
    return h("span", { className }, entry?.qualifier ?? VALUE_LABELS.conditional);
  }
  if (entry?.qualifier !== undefined) {
    return h(
      "span",
      { className },
      VALUE_LABELS[value],
      h("span", { className: "cap-value__qualifier" }, ` (${entry.qualifier})`),
    );
  }
  return h("span", { className }, VALUE_LABELS[value]);
}
