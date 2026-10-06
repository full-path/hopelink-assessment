# CLAUDE.md — Find a Ride Unified Intake Explorer

## 1. Project Objective

A static, client-side web application, deployed to GitHub Pages, that:

1. Ingests a CSV of intake questions currently asked by individual specialized-transportation
   agencies in the Central Puget Sound region.
2. Presents those questions as a single, de-duplicated "unified intake" list.
3. For each question, surfaces metadata: which agencies require it, which treat it as optional,
   which accept self-attestation, which demand documentary proof (and what proof), and any
   upstream/downstream relationship to other questions.
4. Cross-references those questions against what each provider can physically accommodate, so a
   reader can see whether a question is doing any routing work at all — a capability every
   provider offers equally cannot distinguish one provider from another.

Primary audience for the running application: Hopelink leadership, participating pilot agencies,
and the Advisory Committee — reviewing how much intake overlap exists and where standardization
is possible. Hopelink has no regulatory authority over participating agencies, so the tool's
function is persuasion through visibility, not enforcement.

Primary audience for the *codebase*: a competent web developer who did not build it and must be
able to read, verify, and extend it without archaeology. Code clarity is a functional requirement,
not a preference.

## 2. Data Sources

Three CSVs in `/data`, all hand-editable sources of record:

| File | Contents |
|---|---|
| `eligibility-questions.csv` | The intake questions. Cleaned from the agency-survey export (`by-question.csv`), which is kept alongside it so the cleanup is auditable. That export is near-verbatim rather than frozen: a question may be added to it deliberately (see Section 11, item 13), so it is a maintained question bank, not an immutable receipt. Edit it only to add a question, never to restate what an agency answered. |
| `capabilities.csv` | One row per ride provider, one column per capability (wheelchair, lift, service animals, …), free-text answers. |
| `question-capability-map.csv` | An editorial claim that a given question exists in order to determine a given capability. Not derivable from either sheet above — a human asserts it, and the `Note` column records why. Kept as a CSV rather than in code so a program person can review and edit it. |

Columns of `eligibility-questions.csv` as shipped:

| Column | Content |
|---|---|
| `Question` | Intake question text |
| `Providers Required` | Agencies for which this question is mandatory |
| `Providers Optional` | Agencies for which this question is asked but optional |
| `Providers Self Attestation` | Agencies accepting the applicant's word with no proof |
| `Providers Burden of Proof` | Agencies requiring documentary evidence, with the evidence type embedded in the same cell |
| `Upstream Q's` | Free-text reference to a question that must be answered before this one is shown |
| `Downstream Q's` | Free-text reference to a question this one gates |

This file is the input to a normalization step (see Section 4) that runs in two places: at build
time to produce the committed default dataset, and in the browser when a user uploads a
replacement CSV for a session-only preview (Section 5, requirement 6). Both paths go through the
same shared module — the UI never parses raw CSV cells itself.

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
- **Multi-reference link cells.** Some `Upstream Q's` cells name two questions in one cell,
  comma-separated (`Phone number, email`). Commas cannot be the separator here because question
  text contains commas of its own (`Special directions (gate code, etc)`), so the cleaned CSV
  re-delimits these with `;` — the same convention the proof column uses — and `normalize.ts`
  splits on `;`.
- **A referenced question with no row of its own.** `Home address` and `Mailing address` both
  named `Mailing address same as home address?` in their link columns, but the survey had no row
  for it, so both references dangled. It was added deliberately — to `by-question.csv` and to the
  cleaned sheet — with blank agency columns, because no agency answered for it. See Section 11,
  item 13.
- **A link cell pointing outside this sheet.** `Accessibility needs` named
  `Which provider capabilities are needed` as a downstream question. That is not an intake
  question but a pointer at `capabilities.csv`, and the relationship is modelled properly in
  `question-capability-map.csv` (six capability columns, with the editorial reasoning per row).
  The cell is therefore cleared rather than reconciled — it was redundant as well as
  unresolvable.
- **The cleaned sheet now has zero unresolved links.** The *rendering* for them is still live and
  still required: an uploaded CSV (Section 5, requirement 6) can reintroduce one at any time, and
  Section 11 item 2 holds. There is simply nothing in the committed data that triggers it. The
  filter that narrowed the list to them has been removed — see Section 11, item 2.
- **Structural noise.** A blank row follows the header row. Some agency names carry trailing
  whitespace (e.g. `"ORCA "`), some cells end in a trailing comma that yields an empty agency
  token, the `Downstream Q's ` header itself carries a trailing space, and one proof cell
  (Income) spans five physical lines inside its quotes.
- **Free-text capability answers.** `capabilities.csv` answers in prose: `Yes`, `yes`, `No`, `no`,
  `Yes (1)`, `Probably yes`, `Depends on vehicle`, `Yes (Language line)`, and blanks. These are
  mapped to a canonical vocabulary with the agency's own wording kept as a qualifier. **A blank is
  `unknown`, never `no`** — three agencies returned an entirely blank row, and reporting that as
  "does not offer wheelchair access" would be actively false.

None of these should be handled with defensive parsing logic scattered through the application.
They are resolved once, in the shared normalization layer under `src/data/` — `normalize.ts` for
the questions sheet, `normalizeCapabilities.ts` for the capability sheets, with the agency roster
(`agencies.ts`) and string helpers (`text.ts`) shared between them. Every path into the app, build
script and in-browser upload alike, goes through those modules. UI code should never see a raw
CSV row.

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
  kind: "ride_provider" | "fare_program" | "travel_training";
  aliases: string[];       // raw strings from source CSVs mapped to this agency
}

// --- Provider capabilities ---

type CapabilityValue = "yes" | "no" | "conditional" | "unknown";

interface Capability {
  id: string;              // slug of the source column header
  label: string;           // column header verbatim
}

interface AgencyCapability {
  capabilityId: string;
  value: CapabilityValue;
  qualifier?: string;      // the agency's own wording, e.g. "1", "Language line"
}

interface AgencyCapabilityProfile {
  agencyId: string;
  capabilities: AgencyCapability[];
}

interface QuestionCapabilityLink {
  questionText: string;    // resolved to a question id at runtime, not at build time
  capabilityId: string;
  note?: string;           // why a human asserted this link
}
```

`Agency.kind` exists because the roster mixes vehicle operators with fare/pass programs. Vehicle
capabilities are meaningful for the former and a category error for the latter — without the
distinction the capabilities view would report ORCA and SAP as gaps in the survey.

```typescript
// --- Reader comments (persisted; see Section 5, requirement 8) ---

type CommentTargetKind = "question" | "capability";

interface Comment {
  kind: CommentTargetKind;
  id: string;             // an IntakeQuestion.id or a Capability.id
  timestamp: string;      // ISO 8601, stamped server-side
  author: string;
  body: string;
  targetLabel: string;    // question text / capability label as it read when written
}
```

`Comment.targetLabel` is redundant with `id` while the dataset is unchanged, and that is the
point: question ids are slugs of question text, so rewording a question breaks every comment on
it. Keeping the label means an orphan can still be displayed against the thing it was about
rather than as a bare slug.

`QuestionCapabilityLink` stores question *text* rather than an id so it can be re-resolved against
whatever question set is displayed; an uploaded CSV that renames a question loses that link and
has it reported as unmatched, rather than rendering something stale.

Unresolved upstream/downstream references (Section 3) are preserved in `unresolvedLinks` and
rendered in the UI as flagged/unlinked rather than silently dropped. Hiding known-bad data is worse
than displaying it as unresolved. The same rule governs `unknown` capability values, unmatched
question/capability links, and comments whose target is not in the displayed dataset.

## 5. Functional Requirements

1. Single-page list of all unique questions. Each collapsed row carries how many agencies ask
   that question in any form, counted as distinct agencies rather than requirement entries (an
   agency can appear in several of the source CSV's columns for one question, which is one agency
   asking). This is the list's primary signal: most questions turn out to be asked by exactly one
   agency, which is the overlap argument in a single number.

   Alongside it, one small box per agency showing that agency's effective requirement level, or
   that it does not ask. Three constraints make this work and are easy to break:

   - **Box position must mean the same agency on every card.** All cards receive one shared,
     stably ordered id list, so the strips align into columns and a reader can scan down the list
     for a single agency's pattern. Sorting or filtering the ids *per card* destroys the only
     thing the strip is for. `main.ts` derives that list from the roster — including when the
     agency filter narrows it — which is where the ordering guarantee actually lives.
   - **An agency gets one box, at its strictest level.** Agencies appear in several requirement
     columns for the same question; `effectiveLevelByAgency` in `summary.ts` resolves that and is
     shared with the standardization summary so the two cannot disagree.
   - **Tooltips are CSS, not the `title` attribute.** Browsers delay native tooltips by around
     half a second and the delay cannot be configured, which is too slow for sweeping a row of
     sixteen boxes, so the text lives in `data-tip` and is drawn by a `:hover::after` rule. The
     rule is scoped to `.agency-strip .agency-box` because the legend reuses the same class for
     its swatches and those carry no tooltip text.
   - **The strip is always the last element in the header, and is pinned right.** Its boxes only
     invite comparison between questions if they land at the same x position on every card, so
     anything of variable width must come before it — a comment badge reading "1 comment" on one
     row and "3 comments" on the next would shift the strip sideways by a different amount each
     time. New badges go before it, never after.
   - **Colour is a sequential ramp, not five hues.** The levels are ordered (proof required >
     required > self-attestation > optional), so strictness maps to ink; "not asked" sits outside
     the ramp as a faint neutral, and the ramp inverts in dark mode. A legend renders once above
     the list — sixteen boxes in five colours are illegible without it, so it is part of the
     feature, not a nicety.
2. Per-question expandable detail showing, per agency: requirement level and proof detail where
   applicable.
3. Filter/sort by: agency (a multi-select; empty means every agency, and selections are a union
   — "asked by any of these"), requirement level, and relationship
   to provider capabilities (linked to one at all; or a "unified intake candidate" — see item 7).

   An agency selection also narrows the header strip and its count badge, so the number and the
   boxes beside it always describe the same population. It deliberately stops there: the
   requirements table and the standardization summary inside a card keep the **full** population,
   because the summary's proposed level is a mode across agencies and computing it over a
   hand-picked subset would present a region-wide recommendation derived from two agencies. The
   filter is a display control, not an analytical one.
   Candidacy is a *filter* and a finding stated inside the capability panel, deliberately not a
   header badge: the collapsed row has room for one number, and a verdict that needs a sentence
   of explanation to be fair ("the capability varies and most providers don't ask") belongs where
   that sentence can sit next to it.
4. Visual indicator distinguishing questions with resolved upstream/downstream chains from those
   with unresolved free-text references.
5. A summary view answering the core stakeholder question directly: for a given candidate
   "unified" question, which agencies already ask it in compatible form, and which would need to
   change practice (different requirement level or added proof burden).
6. **Currently hidden in the UI, machinery retained.** The control is shown only when
   `VITE_SHOW_CSV_UPLOAD=true` at build time; the default build has no upload affordance. This
   is a deliberate "keep it, don't show it" state — `handleUpload` and `setData` in `main.ts`
   stay wired to the flag so they remain type-checked and tested rather than rotting, and a
   render test asserts both that the control is absent by default and that the flag brings it
   back. Do not delete the machinery to tidy up; the requirement below still stands.

   Upload of a replacement CSV (same column contract as the source file) that the UI re-renders
   from immediately. The upload is a **session-only preview**: it is parsed entirely in the
   browser, held in memory, never sent anywhere, and discarded on reload. A malformed upload
   (unknown agency, missing columns, parse errors) surfaces the error and leaves the currently
   displayed dataset untouched. The committed CSV remains the source of record; making an
   uploaded file permanent still means editing `/data` and rebuilding (Section 8). Upload
   replaces the **intake questions only** — capability data is always the committed set, and the
   question/capability map is re-resolved against the uploaded questions.
7. A provider-capabilities view, and a per-question capability panel, answering: what is this
   question actually determining about a provider, and does that determination distinguish one
   provider from another? A capability every provider offers equally cannot route a rider, so a
   question about it does no work in a unified intake; one that varies while most providers don't
   ask about it is the strongest case for adding it. Reporting gaps are named rather than
   flattened: "surveyed and answered nothing", "never surveyed", and "operates no vehicles, so
   the question does not apply" are three different things and appear as three different things.
8. Reader comments on an individual intake question or provider capability, so the Advisory
   Committee and pilot agencies can respond in the context that prompted the response rather than
   in a separate email thread. Persisted to a Google Sheet via an Apps Script web app
   (`/apps-script/`), gated by a shared passphrase the reader types (never compiled into the
   bundle), append-only from the app, moderated in the sheet. A comment whose target no longer
   exists in the displayed dataset — because a question was reworded, or because an uploaded
   preview drops it — is surfaced as an orphan, never silently reattached or hidden, per the rule
   in Section 4. Commenting is **optional at build time**: with `VITE_COMMENTS_ENDPOINT` unset the
   whole application renders normally with commenting simply absent, and a dead or misconfigured
   endpoint degrades to an error inside the comment areas alone. The analysis is the product;
   comments are an enhancement and may never delay, block, or blank it.

## 6. Non-Functional Requirements / Code Quality Standards

- TypeScript, strict mode, no `any`.
- No framework unless the component tree genuinely warrants one. This is a filterable list with
  detail panels — plain TypeScript + minimal DOM, or a lightweight framework at most. Do not
  introduce state-management libraries, routing libraries, or a component framework to solve a
  problem of this size.
- CSV → JSON normalization lives in the shared modules under `src/data/`, independently testable
  and independent of any UI code. `scripts/build-data.ts` is a thin CLI wrapper around them; the
  browser upload path calls the same functions. `normalize.ts` and `normalizeCapabilities.ts` are
  siblings with no dependency between them — what they share (the agency roster, string
  canonicalization) lives in `agencies.ts` and `text.ts`.
- Analysis that is a *view over* the data rather than part of it — the standardization summary
  (`src/summary.ts`) and the capability variance analysis (`src/capabilities.ts`) — stays out of
  the data contract, as pure functions with no DOM.
- Unit tests for the normalization modules specifically: agency alias resolution, proof-field
  splitting, unresolved-link detection, capability value parsing, question/capability link
  resolution. This is the part of the system most likely to silently produce wrong output, and the
  part least likely to be caught by visual inspection. `src/app.render.test.ts` additionally mounts
  the whole app against the committed data, because a throw inside `render()` yields a blank page
  that every unit test would still pass.
- The comment layer is tested at both ends: `src/comments/resolve.test.ts` for target grouping and
  orphan detection (including the reword case, which must orphan rather than reattach), and
  `src/comments/client.test.ts` for the wire contract — notably that the POST stays a CORS simple
  request, since Apps Script does not answer preflight and the resulting failure looks like a
  generic network error. The render test additionally asserts that a comment body containing
  markup renders as literal text: comment bodies are the only **stored** user-generated content in
  the system, so a raw-HTML sink in `commentThread.ts` would be stored XSS rather than a cosmetic
  bug.
- ESLint + Prettier, checked in.
- No unused dependencies, no scaffolding boilerplate left over from a starter template.
- Semantic HTML and basic ARIA attributes on interactive elements — this is a tool for an
  accessibility-focused transportation program; the tool itself should not be an accessibility
  failure. The per-agency strip is the one place where meaning is carried by colour, so it is
  backed up three ways rather than one: a `title` per box for mouse-over, `role="img"` with a
  single summarising `aria-label` on the strip so assistive technology gets one coherent sentence
  instead of sixteen unlabelled boxes, and the authoritative per-agency breakdown in the
  requirements table in the card body. The boxes are deliberately **not** focusable — the strip
  sits inside a `<summary>`, and making them focusable would add sixteen tab stops per card
  across dozens of cards.
- README sufficient for a developer with no project context to run, test, and rebuild data.

## 7. Technology Stack

- Build tool: Vite.
- Language: TypeScript.
- CSV parsing: `papaparse`, used only inside the shared normalization module. Since that module
  also powers the in-browser upload preview (Section 5, requirement 6), papaparse ships in the
  client bundle — it is a runtime dependency, not a dev-only one.
- No backend **for the intake and capability data**. Output is static HTML/CSS/JS plus two
  generated JSON files (`questions.json`, `capabilities.json`). Uploaded CSVs are processed
  client-side only and never leave the browser.
- **One exception, added for comments (Section 5, requirement 8):** a Google Apps Script web app
  bound to a Google Sheet, checked into `/apps-script/`. It is the only piece of the system that
  persists anything and the only piece that does not deploy from CI. It stores comments and
  nothing else — the analysis itself never depends on it, and the whole app renders normally when
  the endpoint is unset or unreachable.
- UI: plain TypeScript + DOM. Settled at implementation time (Section 11, item 4): the component
  tree never became stateful enough to warrant Preact. The two-view switcher is a hand-rolled ARIA
  tablist rather than a routing library, per the rule above.
- Test environment: `happy-dom`, for the whole-app render test only.

## 8. Build & Deployment Pipeline

1. The three CSVs (Section 2) checked into `/data/` as sources of record.
2. `scripts/build-data.ts` runs at build time, outputs `/src/data/questions.json` and
   `/src/data/capabilities.json`. It warns (without failing) when a question/capability map entry
   matches no question — the map is allowed to lag a CSV edit by one commit.
3. Vite builds static assets.
4. GitHub Actions workflow builds on push to `main` and deploys to GitHub Pages.
5. Updating the intake comparison going forward means editing the CSVs and re-running the build.
   The in-app CSV upload (Section 5, requirement 6) is a session-only preview for trying a
   candidate revision — it does not persist anything; permanent changes still go through this
   pipeline. Building a live-editing interface remains out of scope (Section 10).

## 9. Repository Structure

```
/data/by-question.csv                 # agency-survey export + deliberate additions; the question bank
/data/eligibility-questions.csv       # source of record, hand-edited (cleaned from the above)
/data/capabilities.csv                # source of record: provider capability matrix
/data/question-capability-map.csv     # source of record: editorial question -> capability claims
/scripts/build-data.ts                # thin CLI: reads the CSVs, writes the JSON via the shared modules
/src/data/text.ts                     # string canonicalization shared by both normalizers
/src/data/agencies.ts                 # canonical agency roster + alias resolution
/src/data/normalize.ts                # questions:     CSV text -> NormalizedData
/src/data/normalizeCapabilities.ts    # capabilities:  CSV text -> CapabilityData
/src/data/normalize.test.ts
/src/data/normalizeCapabilities.test.ts
/src/data/questions.json              # generated, committed
/src/data/capabilities.json           # generated, committed
/src/data/types.ts                    # the data contract
/src/summary.ts                       # standardization analysis (view over the data)
/src/capabilities.ts                  # capability variance analysis (view over the data)
/src/capabilities.test.ts
/src/app.render.test.ts               # whole-app render smoke test (happy-dom)
/src/comments/types.ts                # the comment data contract
/src/comments/client.ts               # transport to the Apps Script store (the only network I/O)
/src/comments/resolve.ts              # comments -> targets in the active dataset; orphan detection
/src/comments/resolve.test.ts
/src/comments/client.test.ts
/src/main.ts
/src/components/
/src/styles/
/apps-script/Comments.gs              # the comment store; deployed by hand, checked in for review
/apps-script/README.md                # how to deploy and moderate it
/src/vite-env.d.ts                    # typing for VITE_* build-time configuration
/.github/workflows/deploy.yml
README.md
CLAUDE.md
```

## 10. Out of Scope

- Persisting an uploaded CSV. Upload exists (Section 5, requirement 6) but is a session-only,
  in-browser preview — no server-side storage, no write-back to the repo, no sharing of an
  uploaded dataset between users or sessions. **This remains true and is unaffected by comments:**
  comments persist, uploaded datasets still do not, and a comment is never written against an
  uploaded preview's data in any way that outlives the session.
- Editing or deleting a comment from the UI, threaded replies, and notifications. Moderation
  happens in the Google Sheet (`apps-script/README.md`); the app is append-only.
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
   tool to only show clean, resolved chains, this assumption is wrong. As of the current data
   every reference resolves, so nothing exercises this path. The *rendering* is kept — that is
   the commitment this item is about, and an uploaded CSV can reintroduce an unresolved link at
   any time. The "only show questions with unresolved links" **filter** has been removed: with
   nothing to find it was a control that could only ever empty the list, and the upload path
   that could reintroduce matches is itself hidden by default (requirement 6). Restore it if a
   future dataset carries unresolved references again.
3. **JSON output is committed to the repo**, not generated fresh on every deploy from a build
   secret or external source, since the CSV itself is committed. Confirm this is acceptable before
   assuming the data is non-sensitive enough to commit in plaintext — it is aggregate policy data,
   not rider PII, but confirm no agency considers its own intake practices confidential.
4. ~~**No framework decision has been finalized**~~ — settled. Plain TypeScript + DOM; the
   component tree never became stateful enough to warrant Preact.
5. **Paraphrased link references were matched, not dropped.** Three upstream references in the raw
   export name a question by paraphrase rather than exact text: `Phone number` → `Phone`,
   `Preferred Language` → `Primary language`, `Disability status` → `Disabled`. These were matched
   by hand in the cleaned CSV and the assumption recorded in that row's `Data Quality Notes`. The
   normalizer itself still does no fuzzy matching. If any of these three is wrong, fix the CSV.
6. **`SAP` is carried as its bare acronym** because the source never expands it. Confirm what it
   stands for before it appears in anything stakeholder-facing.
7. **`Pierce SHUTTLE`**, named in the question "Are you registered with Pierce SHUTTLE", is not on
   the agency roster. Whether it is the roster's `Pierce Runner` or a separate Pierce County
   program is unresolved.
8. **`Community Van` is on the roster but has no intake data.** It appears in
   `data/capabilities.csv` and asks no questions in the intake sheet. Rather than omit it, views
   that list agencies per question derive their population from the question data, so it does not
   appear as "does not ask" on every question; the capabilities coverage view names the gap
   explicitly instead. Confirm whether its intake questions simply weren't surveyed.
9. **Agency `kind` classification is an assumption.** `ORCA`, `ORCA (Senior)`, `ORCA (Disabled)`,
   `ORCA LIFT` and `SAP` are treated as fare/pass programs and `Metro Transit Instruction` as
   travel training, meaning vehicle capabilities are reported as "not applicable" rather than as a
   survey gap. The evidence is that `capabilities.csv` surveyed exactly the ride providers and none
   of these. If any of them does operate vehicles, correct `kind` in `src/data/agencies.ts`.
10. **The question → capability map is editorial.** Nothing in either CSV asserts that
    "Do you require portable Oxygen" exists to determine the "Portable Oxygen" capability; a human
    claimed it in `data/question-capability-map.csv`, with the reasoning in each row's `Note`.
    Mappings deliberately *not* made, because they were arguable rather than clear: "Do you have
    hearing issues or sight issues" → Interpretation Support, "Do you require any special
    assistance (extra load time, comfort pet, etc)" → Allows service animals, "How many riders to
    expect" → Allows for companions. Review the file before relying on the analysis it drives.
11. **Comments are attributable free text from named agency staff.** They are not rider PII —
    Section 10's prohibition is intact — but they are on-the-record statements about an agency's
    own intake practice, stored in a Google Sheet outside this repository, behind a shared
    passphrase rather than per-person authentication. The endpoint URL is public by construction
    (it ships in the client bundle). Confirm participating agencies are comfortable commenting
    under those terms before the passphrase is circulated. This is the same question Section 11
    item 3 asks about the committed CSVs, but with a lower answer threshold: a CSV is aggregate
    policy data, a comment is a person's opinion with their name on it.
12. **"Varies" is judged only on providers that answered**, with a minimum of two responses before
    any verdict is offered. With three agencies returning entirely blank surveys and two never
    surveyed, several verdicts rest on three or four responses. The counts are displayed alongside
    every verdict so a reader can weigh them, but the analysis will firm up considerably if the
    non-responding agencies are chased.
13. **`Mailing address same as home address?` was added, not surveyed.** It existed only as a
    reference from the `Home address` and `Mailing address` rows. It was added deliberately to
    both `by-question.csv` and `eligibility-questions.csv` as a question in its own right, which
    is why `by-question.csv` is described in Section 2 as a maintained question bank rather than
    a frozen export. Because the survey never asked it, it carries no requirement levels or proof
    burden and its agency columns are blank; the gap is in the survey, not in the sheet. It is
    recorded here so a later reader does not mistake the blank row for a parsing failure, and so
    the one open question stays visible: ask the agencies how they handle it, and the columns can
    be filled in.
