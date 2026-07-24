import { h } from "../dom";
import type { Agency, RequirementLevel } from "../data/types";

// The `string & {}` intersection keeps "all" from collapsing into the wider string
// type, so the union still reads as two distinct cases at the type level.
export interface FilterState {
  agencyId: "all" | (string & {});
  level: RequirementLevel | "all";
  onlyUnresolved: boolean;
}

export const LEVEL_LABELS: Record<RequirementLevel, string> = {
  required: "Required",
  optional: "Optional",
  self_attestation: "Self-Attestation",
  proof_required: "Proof Required",
};

export function renderFilters(
  agencies: Agency[],
  state: FilterState,
  onChange: (next: FilterState) => void,
): HTMLElement {
  const agencySelect = h(
    "select",
    {
      id: "filter-agency",
      onChange: (e) => {
        onChange({ ...state, agencyId: (e.target as HTMLSelectElement).value });
      },
    },
    h("option", { value: "all", selected: state.agencyId === "all" }, "All agencies"),
    ...agencies.map((agency) =>
      h("option", { value: agency.id, selected: state.agencyId === agency.id }, agency.displayName),
    ),
  );

  const levelSelect = h(
    "select",
    {
      id: "filter-level",
      onChange: (e) => {
        onChange({
          ...state,
          level: (e.target as HTMLSelectElement).value as RequirementLevel | "all",
        });
      },
    },
    h("option", { value: "all", selected: state.level === "all" }, "Any requirement level"),
    ...(Object.entries(LEVEL_LABELS) as [RequirementLevel, string][]).map(([value, label]) =>
      h("option", { value, selected: state.level === value }, label),
    ),
  );

  const unresolvedCheckbox = h("input", {
    type: "checkbox",
    id: "filter-unresolved",
    checked: state.onlyUnresolved,
    onChange: (e) => {
      onChange({ ...state, onlyUnresolved: (e.target as HTMLInputElement).checked });
    },
  });

  return h(
    "form",
    { className: "filters", "aria-label": "Filter questions" },
    h(
      "div",
      { className: "filters__field" },
      h("label", { for: "filter-agency" }, "Agency"),
      agencySelect,
    ),
    h(
      "div",
      { className: "filters__field" },
      h("label", { for: "filter-level" }, "Requirement level"),
      levelSelect,
    ),
    h(
      "div",
      { className: "filters__field filters__field--checkbox" },
      unresolvedCheckbox,
      h("label", { for: "filter-unresolved" }, "Only show questions with unresolved links"),
    ),
  );
}
