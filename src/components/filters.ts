import { h } from "../dom";
import type { Agency, AgencyGroup, RequirementLevel } from "../data/types";

export interface FilterState {
  /**
   * Agencies to narrow to. **Empty means every agency**, not none — the natural reading of an
   * untouched set of checkboxes, and it keeps "no filter" from needing a sentinel value.
   *
   * Held in roster order rather than click order, so the state is deterministic regardless of
   * the sequence boxes were ticked in. Note this is not what guarantees the header strip's
   * order — `main.ts` re-derives that from the roster — so changing it here cannot silently
   * scramble the strip.
   */
  agencyIds: string[];
  level: RequirementLevel | "all";
  capability: CapabilityFilter;
}

/**
 * Narrows the list by what a question determines about a provider:
 *  - `linked`   — the question maps to at least one provider capability;
 *  - `candidate` — of those, the ones whose capability actually varies between providers while
 *    most providers don't yet ask it. This is the shortlist the standardization case rests on.
 */
export type CapabilityFilter = "all" | "linked" | "candidate";

const CAPABILITY_LABELS: Record<CapabilityFilter, string> = {
  all: "Any capability link",
  linked: "Linked to a provider capability",
  candidate: "Unified intake candidates",
};

export const LEVEL_LABELS: Record<RequirementLevel, string> = {
  required: "Required",
  optional: "Optional",
  self_attestation: "Self-Attestation",
  proof_required: "Proof Required",
};

/**
 * Shown beside a self-attestation / proof level when the agency never said whether it asks the
 * question as required or optional (`AgencyRequirement.askedUnknown`).
 */
export const ASKED_UNKNOWN_LABEL = "not stated whether required or optional";

export function renderFilters(
  agencies: Agency[],
  agencyGroups: AgencyGroup[],
  state: FilterState,
  onChange: (next: FilterState) => void,
): HTMLElement {
  const selected = new Set(state.agencyIds);

  /** Re-derives the selection from the roster, so the stored array never depends on click order. */
  const selectionWith = (agencyIds: string[], checked: boolean): string[] => {
    const next = new Set(selected);
    for (const agencyId of agencyIds) {
      if (checked) next.add(agencyId);
      else next.delete(agencyId);
    }
    return agencies.filter((agency) => next.has(agency.id)).map((agency) => agency.id);
  };

  /**
   * Groups as they apply to this list: only members that appear in it (a group may include an
   * agency with no intake data, which has no checkbox here), and only groups left with any.
   */
  const listed = new Set(agencies.map((agency) => agency.id));
  const groups = agencyGroups
    .map((group) => ({ ...group, agencyIds: group.agencyIds.filter((id) => listed.has(id)) }))
    .filter((group) => group.agencyIds.length > 0);

  /**
   * A group is a shortcut over the same selection, not a second kind of filter: ticking it ticks
   * every member, unticking it unticks every member, and its own state is read back from the
   * members — checked when all are selected, indeterminate when some are. So a group and its
   * members can never disagree, and there is nothing extra to keep in sync or reset.
   */
  const groupToggles = groups.map((group) => {
    const inputId = `filter-group-${group.id}`;
    const selectedCount = group.agencyIds.filter((id) => selected.has(id)).length;
    const input = h("input", {
      type: "checkbox",
      id: inputId,
      value: group.id,
      checked: selectedCount === group.agencyIds.length,
      onChange: (e) => {
        onChange({
          ...state,
          agencyIds: selectionWith(group.agencyIds, (e.target as HTMLInputElement).checked),
        });
      },
    });
    // Only settable as a property; assistive technology reads it as "mixed".
    input.indeterminate = selectedCount > 0 && selectedCount < group.agencyIds.length;
    return h(
      "div",
      { className: "filters__checkbox" },
      input,
      h("label", { for: inputId }, `${group.name} (${String(group.agencyIds.length)})`),
    );
  });

  /** The group whose members are exactly the selection, if any — named in the summary. */
  const matchingGroup = groups.find(
    (group) =>
      group.agencyIds.length === selected.size && group.agencyIds.every((id) => selected.has(id)),
  );

  const agencyToggles = agencies.map((agency) => {
    const inputId = `filter-agency-${agency.id}`;
    return h(
      "div",
      { className: "filters__checkbox" },
      h("input", {
        type: "checkbox",
        id: inputId,
        value: agency.id,
        checked: selected.has(agency.id),
        onChange: (e) => {
          onChange({
            ...state,
            agencyIds: selectionWith([agency.id], (e.target as HTMLInputElement).checked),
          });
        },
      }),
      h("label", { for: inputId }, agency.displayName),
    );
  });

  // A disclosure rather than a <select multiple>: ctrl-click multiselects are easy to use wrong
  // and give no sign of what is selected while collapsed. Checkboxes are keyboard-navigable and
  // screen-reader-legible with no custom widget semantics to get right, and the summary states
  // the selection so it is readable without opening the group.
  const agencyFilter = h(
    "details",
    { className: "filters__agencies", id: "filter-agency", open: selected.size > 0 },
    h(
      "summary",
      {},
      selected.size === 0
        ? `Agency: all ${String(agencies.length)}`
        : matchingGroup
          ? `Agency: ${matchingGroup.name} (${String(selected.size)} of ${String(agencies.length)})`
          : `Agency: ${String(selected.size)} of ${String(agencies.length)} selected`,
    ),
    groupToggles.length > 0
      ? h(
          "div",
          {
            className: "filters__group-list",
            role: "group",
            "aria-labelledby": "filter-groups-label",
          },
          h("span", { className: "filters__sublabel", id: "filter-groups-label" }, "Groups"),
          ...groupToggles,
        )
      : undefined,
    h(
      "div",
      { className: "filters__agency-list", role: "group", "aria-label": "Agencies" },
      ...agencyToggles,
      h(
        "button",
        {
          type: "button",
          className: "filters__clear",
          id: "filter-agency-clear",
          disabled: selected.size === 0,
          onClick: () => {
            onChange({ ...state, agencyIds: [] });
          },
        },
        "Show all agencies",
      ),
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

  const capabilitySelect = h(
    "select",
    {
      id: "filter-capability",
      onChange: (e) => {
        onChange({
          ...state,
          capability: (e.target as HTMLSelectElement).value as CapabilityFilter,
        });
      },
    },
    ...(Object.entries(CAPABILITY_LABELS) as [CapabilityFilter, string][]).map(([value, label]) =>
      h("option", { value, selected: state.capability === value }, label),
    ),
  );

  return h(
    "form",
    { className: "filters", "aria-label": "Filter questions" },
    agencyFilter,
    h(
      "div",
      { className: "filters__field" },
      h("label", { for: "filter-level" }, "Requirement level"),
      levelSelect,
    ),
    h(
      "div",
      { className: "filters__field" },
      h("label", { for: "filter-capability" }, "Provider capability"),
      capabilitySelect,
    ),
  );
}
