# CLAUDE.md — Find a Ride Unified Intake Explorer

## 1. Project Objective

A static, client-side web application, deployed to GitHub Pages, that:

1. Ingests a CSV of intake questions currently asked by individual specialized-transportation
   agencies in the Central Puget Sound region.
2. Presents those questions as a single, de-duplicated "unified intake" list.
3. For each question, surfaces metadata: which agencies require it, which treat it as optional,
   which accept self-attestation, which demand documentary proof (and what proof), and any
   upstream/downstream relationship to other questions.

Primary audience for the running application: Hopelink leadership, participating pilot agencies,
and the Advisory Committee — reviewing how much intake overlap exists and where standardization
is possible. Hopelink has no regulatory authority over participating agencies, so the tool's
function is persuasion through visibility, not enforcement.

Primary audience for the *codebase*: a competent web developer who did not build it and must be
able to read, verify, and extend it without archaeology. Code clarity is a functional requirement,
not a preference.

## 2. Data Source

Source file: `Eligibility_Questions.csv`. Columns as shipped:

| Column | Content |
|---|---|
| `Question` | Intake question text |
| `Providers Required` | Agencies for which this question is mandatory |
| `Providers Optional` | Agencies for which this question is asked but optional |
| `Providers Self Attestation` | Agencies accepting the applicant's word with no proof |
| `Providers Burden of Proof` | Agencies requiring documentary evidence, with the evidence type embedded in the same cell |
| `Upstream Q's` | Free-text reference to a question that must be answered before this one is shown |
| `Downstream Q's` | Free-text reference to a question this one gates |

This file is the **input to a build-time preprocessing step**, not something the browser parses
directly. See Section 4.

## 3. Data Anomalies Confirmed in Source (Must Be Resolved Before Ingestion)

The following defects exist in the current CSV and will produce incorrect output if the
application parses the raw cells directly at runtime:

- **Agency name variants.** `Beyond the borders` vs `Beyond the Borders`; `Access paratransit` vs
  `Access Paratransit`; `ORCA` appears bare and as `ORCA (Senior)`, `ORCA (disabled)`,
  `ORCA LIFT`. A canonical agency list and alias-resolution table is required. Whether the ORCA
  variants are distinct programs or inconsistent labeling of one program is unresolved in the
  source data — see Section 11, item 1.
- **Non-resolvable linkage.** `Upstream Q's` / `Downstream Q's` reference other questions by
  paraphrase, not exact text match or ID. They cannot be turned into a navigable graph without
  manual reconciliation against the `Question` column.
- **Overloaded proof field.** `Providers Burden of Proof` interleaves agency name and proof-detail
  text using the same comma delimiter used elsewhere for agency lists, e.g.
  `ORCA (ProviderOne number OR EBT number OR DSHS Client ID number)`. Naive comma-splitting breaks
  this.
- **Structural noise.** A blank row follows the header row. Some agency names carry trailing
  whitespace (e.g. `"ORCA "`).

None of these should be handled with defensive parsing logic scattered through the application.
They are resolved once, at build time, in a single normalization script, producing a clean typed
JSON artifact that the application consumes. Application code should never see a raw CSV row.

## 4. Data Model (Normalized Output of Preprocessing)

Preprocessing script output — the only data contract the frontend depends on:

```typescript
type RequirementLevel = "required" | "optional" | "self_attestation" | "proof_required";

interface AgencyRequirement {
  agencyId: string;        // canonical, resolved from alias table
  level: RequirementLevel;
  proofDetail?: string;    // populated only when level === "proof_required"
}

interface IntakeQuestion {
  id: string;              // stable slug generated from question text
  text: string;
  requirements: AgencyRequirement[];
  upstreamRefs: string[];  // resolved question ids; empty array if unresolved/unmatched
  downstreamRefs: string[];
  unresolvedLinks?: string[]; // raw text that could not be matched to a question id — surfaced, not hidden
}

interface Agency {
  id: string;
  displayName: string;
  aliases: string[];       // raw strings from source CSV mapped to this agency
}
```

Unresolved upstream/downstream references (Section 3) are preserved in `unresolvedLinks` and
rendered in the UI as flagged/unlinked rather than silently dropped. Hiding known-bad data is worse
than displaying it as unresolved.

## 5. Functional Requirements

1. Single-page list of all unique questions.
2. Per-question expandable detail showing, per agency: requirement level and proof detail where
   applicable.
3. Filter/sort by: agency, requirement level, presence of unresolved links.
4. Visual indicator distinguishing questions with resolved upstream/downstream chains from those
   with unresolved free-text references.
5. A summary view answering the core stakeholder question directly: for a given candidate
   "unified" question, which agencies already ask it in compatible form, and which would need to
   change practice (different requirement level or added proof burden).

## 6. Non-Functional Requirements / Code Quality Standards

- TypeScript, strict mode, no `any`.
- No framework unless the component tree genuinely warrants one. This is a filterable list with
  detail panels — plain TypeScript + minimal DOM, or a lightweight framework at most. Do not
  introduce state-management libraries, routing libraries, or a component framework to solve a
  problem of this size.
- CSV → JSON normalization lives in one script (`scripts/build-data.ts`), independently testable,
  independent of any UI code.
- Unit tests for the normalization script specifically: agency alias resolution, proof-field
  splitting, unresolved-link detection. This is the part of the system most likely to silently
  produce wrong output, and the part least likely to be caught by visual inspection.
- ESLint + Prettier, checked in.
- No unused dependencies, no scaffolding boilerplate left over from a starter template.
- Semantic HTML and basic ARIA attributes on interactive elements — this is a tool for an
  accessibility-focused transportation program; the tool itself should not be an accessibility
  failure.
- README sufficient for a developer with no project context to run, test, and rebuild data.

## 7. Technology Stack

- Build tool: Vite.
- Language: TypeScript.
- CSV parsing: `papaparse`, used only inside the build-time normalization script — never shipped
  to the client bundle.
- No backend. No runtime database. Output is static HTML/CSS/JS plus one generated JSON file.
- UI: plain TypeScript + DOM, or Preact if component structure proves warranted during
  implementation. Decision deferred to implementation time based on actual complexity, not
  assumed upfront.

## 8. Build & Deployment Pipeline

1. `Eligibility_Questions.csv` checked into `/data/` as source of record.
2. `scripts/build-data.ts` runs at build time, outputs `/src/data/questions.json`.
3. Vite builds static assets.
4. GitHub Actions workflow builds on push to `main` and deploys to GitHub Pages.
5. Updating the intake comparison going forward means editing the CSV and re-running the build —
   no live editing UI. Building a live-editing interface is explicitly out of scope (Section 10)
   unless a future requirement changes this.

## 9. Repository Structure

```
/data/Eligibility_Questions.csv       # source of record, hand-edited
/scripts/build-data.ts                # normalization: CSV -> questions.json
/scripts/build-data.test.ts           # tests for normalization logic
/src/data/questions.json              # generated, gitignored or committed — decide at implementation
/src/main.ts
/src/components/                      # only if warranted
/src/styles/
/.github/workflows/deploy.yml
README.md
CLAUDE.md
```

## 10. Out of Scope

- Live/runtime CSV upload by end users.
- Authentication or per-agency accounts.
- Persisting any rider or PII data — this tool operates on aggregate policy metadata only, never
  individual rider records. It has no relationship to the Vault, Dashboard, or Workflow Tracker
  components of the Phase 2 architecture and should not be conflated with them.
- Editing the unified intake data through a UI.

## 11. Open Decisions Requiring Confirmation

The following were assumed rather than confirmed, and building proceeds on these assumptions
unless corrected:

1. **ORCA variants.** Assumed to be distinct programs (`ORCA`, `ORCA (Senior)`, `ORCA (disabled)`,
   `ORCA LIFT`) and treated as separate agency entities in the alias table, not merged. If they are
   in fact one program inconsistently labeled in the source data, the alias table must be
   corrected before the normalization output is trustworthy.
2. **Unresolved links stay visible.** Upstream/downstream references that cannot be matched to a
   question id are displayed as flagged rather than silently discarded. If the intent was for the
   tool to only show clean, resolved chains, this assumption is wrong.
3. **JSON output is committed to the repo**, not generated fresh on every deploy from a build
   secret or external source, since the CSV itself is committed. Confirm this is acceptable before
   assuming the data is non-sensitive enough to commit in plaintext — it is aggregate policy data,
   not rider PII, but confirm no agency considers its own intake practices confidential.
4. **No framework decision has been finalized** (Section 7) — plain TypeScript is the default;
   escalate to Preact only if implementation reveals genuine component-state complexity.
