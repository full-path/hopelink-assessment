export type RequirementLevel = "required" | "optional" | "self_attestation" | "proof_required";

export interface AgencyRequirement {
  agencyId: string; // canonical, resolved from alias table
  level: RequirementLevel;
  proofDetail?: string; // populated only when level === "proof_required"
}

export interface IntakeQuestion {
  id: string; // stable slug generated from question text
  text: string;
  requirements: AgencyRequirement[];
  upstreamRefs: string[]; // resolved question ids; empty array if unresolved/unmatched
  downstreamRefs: string[];
  unresolvedLinks?: string[]; // raw text that could not be matched to a question id — surfaced, not hidden
  dataQualityNote?: string; // carried verbatim from the source CSV's "Data Quality Notes" column, if present
}

export interface Agency {
  id: string;
  displayName: string;
  aliases: string[]; // raw strings from source CSV mapped to this agency
}

export interface NormalizedData {
  agencies: Agency[];
  questions: IntakeQuestion[];
}
