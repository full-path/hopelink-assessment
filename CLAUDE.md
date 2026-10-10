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
5. Optionally reads all of the above from a published Google Sheet that program staff edit, so an
   edit is visible on the next page load without a developer or a rebuild (Section 5,
   requirement 9). The CSVs in `/data` are then a committed snapshot of that sheet.

Primary audience for the running application: Hopelink leadership, participating pilot agencies,
and the Advisory Committee — reviewing how much intake overlap exists and where standardization
is possible. Hopelink has no regulatory authority over participating agencies, so the tool's
function is persuasion through visibility, not enforcement.

Primary audience for the *codebase*: a competent web developer who did not build it and must be
able to read, verify, and extend it without archaeology. Code clarity is a functional requirement,
not a preference.

## 2. Data Sources

Eight CSVs in `/data`, one per tab of the Google Sheet, all hand-editable. Where a live sheet is
configured (Section 5, requirement 9) it is the working source of record and these files are its
committed snapshot — refreshed by `npm run pull-sheet`, and what the page paints first and falls
back to. With no sheet configured they are the source of record outright.

The layout is **one value per cell**: every multi-value cell, delimiter convention and
text-matched reference of the original export (Section 3) was replaced by rows and stable IDs, so
that a sheet edited continually by staff can be validated cell by cell, in the sheet, with
dropdowns. Other tabs refer to questions and capabilities by ID and to agencies by name.

| File / tab | Columns | Contents |
|---|---|---|
| `agency-groups.csv` — Agency groups | `Group`, `Agency`, `Note` | Named groups of agencies, one row per membership, that readers can show or hide as a unit (Section 5, requirement 3). Many-to-many: a separate tab rather than a column on Agencies, because a column would hold several group names in one cell. A viewing aid only — no analysis reads it. |
| `agencies.csv` — Agencies | `Agency`, `Kind`, `Aliases`, `Capability survey`, `Note` | The agency roster. Every agency name anywhere must resolve against it (name or `;`-separated alias). `Capability survey` (`Returned` / blank) states whether the agency returned the capability survey, rather than leaving it inferred. Data rather than code so staff can add an agency without a developer. |
| `questions.csv` — Questions | `ID`, `Question`, `Data Quality Notes` | The intake questions, in display order. `ID` is assigned once and never changed; the original ids were the slugs of the original text and were kept, so existing comments stayed attached. |
| `requirements.csv` — Requirements | `Question ID`, `Agency`, `Asked`, `Verification`, `Proof detail` | One row per (question, agency), never two. `Asked` ∈ Required / Optional / Unknown, never blank; `Verification` ∈ Self-attestation / Proof required / blank, required when `Asked` is Unknown. These are two separate facts — is it mandatory, and how is the answer checked — that the export stored as four columns of one list, which is what allowed contradictions. |
| `question-links.csv` — Question links | `Question ID`, `Leads to`, `Note` | One row per link, in the direction it gates. Upstream and downstream are both derived from it, so a link can no longer be recorded on one side only. |
| `capabilities.csv` — Capabilities | `ID`, `Label` | Provider capabilities. Stable ID, rewordable label. |
| `provider-capabilities.csv` — Provider capabilities | `Agency`, `Capability ID`, `Answer`, `Agency's wording` | One row per answer. `Answer` ∈ Yes / No / Conditional; the agency's own phrasing goes in `Agency's wording`. A missing row is `unknown`, never `no`. |
| `question-capability-map.csv` — Question-capability map | `Question ID`, `Capability ID`, `Note` | An editorial claim that a question exists to determine a capability. Not derivable from the other tabs — a human asserts it, and `Note` records why. |

`by-question.csv` is the agency-survey export the data was first cleaned from, kept so that
cleanup stays auditable. It is near-verbatim rather than frozen: a question may be added to it
deliberately (see Section 11, item 13). It is not read by the app or published to the sheet; edit
it only to add a question, never to restate what an agency answered.

The tabs are normalized (Section 4) in three places: at build time to produce the committed
snapshot, in the browser when the live sheet loads (Section 5, requirement 9), and in the browser
when a user uploads replacement question tabs for a session-only preview (Section 5,
requirement 6). All paths go through the same shared modules — the UI never parses raw CSV cells
itself. `apps-script/SheetSetup.gs` mirrors the same rules inside the sheet (dropdowns, ID rules,
highlighting, a Checks tab) so staff see a mistake before readers do; the app remains the
authority.

## 3. Data Anomalies in the Original Export

The original agency-survey export, and the first hand-cleaned CSV made from it, had the defects
below. Each was resolved once, by hand, in the cleaned data; the current layout (Section 2) then
removed the *structure* that allowed most of them, so they cannot be re-entered. They are kept
here as the record of what the data went through, and of what an uploaded or pulled file could
still get wrong.

- **Agency name variants.** `Beyond the borders` vs `Beyond the Borders`; `Access paratransit` vs
  `Access Paratransit`; `ORCA` appears bare and as `ORCA (Senior)`, `ORCA (disabled)`,
  `ORCA LIFT`. *Now:* the roster's aliases resolve them, and the sheet offers agency names as a
  dropdown. The ORCA variants are treated as distinct programs — Section 11, item 1.
- **Non-resolvable linkage.** `Upstream Q's` / `Downstream Q's` named other questions by
  paraphrase, not exact text or ID. Three paraphrases were matched by hand (Section 11, item 5).
  *Now:* links are by question ID, picked from a dropdown.
- **Overloaded proof field.** `Providers Burden of Proof` interleaved agency names and proof text
  with commas, e.g. `ORCA (ProviderOne number OR EBT number OR DSHS Client ID number)`, and was
  re-delimited with `;` in the cleaned CSV. *Now:* agency and proof detail are separate cells.
- **Multi-reference link cells.** Some link cells named two questions (`Phone number, email`) in
  text that itself contains commas. *Now:* one link per row.
- **Contradictions and gaps.** An agency could appear in both Required and Optional for one
  question (ORCA on `Phone`), or have a checking method with no Required/Optional entry (six
  pairs). *Now:* one row per question and agency makes the first impossible to enter; the second
  is a Requirements row with `Asked: Unknown`, accepted and shown as "not stated". How each case
  was settled is in Section 11, item 15.
- **One-sided links.** A link was sometimes recorded only on one of its two questions (the
  ProviderOne row's note flags one case). *Now:* derived from a single row, shown at both ends.
- **A referenced question with no row of its own.** `Mailing address same as home address?` was
  named by two rows but had none; it was added deliberately with no agency data. See Section 11,
  item 13.
- **A link cell pointing outside the sheet.** `Accessibility needs` named
  `Which provider capabilities are needed` as downstream — a pointer at capability data, modelled
  properly in the question-capability map — so it was cleared rather than reconciled.
- **Zero unresolved links in the committed data.** The *rendering* for them is still live and
  still required: an uploaded preview or a sheet edit can reintroduce one (a link to an ID that
  does not exist), and Section 11 item 2 holds. The filter that narrowed the list to them has been
  removed — see Section 11, item 2.
- **Structural noise.** A blank row after the header, trailing whitespace in agency names
  (`"ORCA "`), trailing commas yielding empty agency tokens, a `Downstream Q's ` header with a
  trailing space, and a proof cell spanning five physical lines. *Now:* whitespace is normalized
  on read, blank rows skipped, and every remaining cell holds one value.
- **Free-text capability answers.** `Yes`, `yes`, `No`, `no`, `Yes (1)`, `Probably yes`,
  `Depends on vehicle`, `Yes (Language line)`, and blanks. *Now:* `Answer` is a dropdown and the
  agency's own wording has its own column. **A blank is `unknown`, never `no`** — three agencies
  returned an entirely blank survey, and reporting that as "does not offer wheelchair access"
  would be actively false.

None of this should be handled with defensive parsing logic scattered through the application.
It lives once, in the shared normalization layer under `src/data/` — `normalize.ts` for the
question tabs, `normalizeCapabilities.ts` for the capability tabs, with the roster parser and
resolver (`agencies.ts`), the tab helpers (`tabs.ts`: header checks, dropdown matching, the ID
rule) and string helpers (`text.ts`) shared between them, and `dataset.ts` normalizing all eight
tabs as one unit. Every path into the app — build script, live sheet and in-browser upload alike —
goes through those modules. UI code should never see a raw CSV row. Every rejection names the tab
and row, because the person reading it is a staff member looking at the sheet.

## 4. Data Model (Normalized Output of Preprocessing)

Preprocessing script output — the only data contract the frontend depends on:

```typescript
type RequirementLevel = "required" | "optional" | "self_attestation" | "proof_required";

interface AgencyRequirement {
  agencyId: string;        // canonical, resolved from alias table
  level: RequirementLevel;
  proofDetail?: string;    // populated only when level === "proof_required"
  askedUnknown?: true;     // on a verification entry: the agency never said required vs optional
}

interface AgencyGroup {
  id: string;              // slug of the name; nothing persistent is keyed by it
  name: string;
  agencyIds: string[];     // in roster order
}

interface Roster {
  agencies: Agency[];
  agencyGroups: AgencyGroup[];
}

interface NormalizedData extends Roster {
  questions: IntakeQuestion[];
}

interface IntakeQuestion {
  id: string;              // assigned once in the Questions tab, never changed
  text: string;
  requirements: AgencyRequirement[];
  upstreamRefs: string[];  // resolved question ids; empty array if unresolved/unmatched
  downstreamRefs: string[];
  unresolvedLinks?: string[]; // linked question ids that do not exist — surfaced, not hidden
  dataQualityNote?: string;
}

interface Agency {
  id: string;
  displayName: string;
  kind: "ride_provider" | "fare_program" | "travel_training";
  aliases: string[];       // raw strings from source CSVs mapped to this agency
  capabilitySurvey: "returned" | "not_surveyed"; // stated in the roster, not inferred
}

// --- Provider capabilities ---

type CapabilityValue = "yes" | "no" | "conditional" | "unknown";

interface Capability {
  id: string;              // assigned once in the Capabilities tab, never changed
  label: string;           // rewordable
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
  questionId: string;      // resolved against the displayed questions at runtime
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

Question and capability ids are assigned in the sheet and never derived from text, so rewording a
question or relabelling a capability keeps every comment on it. (Before the sheet layout, ids were
slugs of the text and any rewording orphaned the discussion.) `Comment.targetLabel` is still kept:
a question can be deleted, or its id changed against the rules, and the label means the orphan can
still be displayed against the thing it was about rather than as a bare id.

`AgencyCapabilityProfile` exists only for agencies whose `capabilitySurvey` is `returned`; its
unanswered capabilities are `unknown`. No profile means never surveyed. The two are different
facts and the coverage view reports them differently.

`QuestionCapabilityLink` is resolved against whatever question set is displayed rather than at
build time, so an uploaded preview that drops a question loses that link and has it reported as
unmatched, rather than rendering something stale.

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
   - **Colour is an ordinal ramp, not five hues.** The levels are ordered (proof required >
     required > self-attestation > optional), so strictness maps to ink. The ramp inverts in dark
     mode, with its own validated steps rather than a flip of the light ones. A legend renders
     once above the list — sixteen boxes in five states are illegible without it, so it is part
     of the feature, not a nicety.
   - **The ramp steps are measured, not chosen by eye.** They satisfy the ordinal checks:
     monotone lightness, adjacent ΔL >= 0.06, a single hue, and the light end clearing 2:1
     against the surface it sits on. The first version of this ramp ended at `#c7dbfd`, which
     measures **1.37:1 on white** — effectively invisible, and the reason Optional and Not asked
     could not be told apart. Re-validate before changing any step; do not substitute a
     better-looking value.
   - **"Not asked" is encoded by fill, not by hue.** It is an absence rather than a weaker level,
     so it renders as an empty cell against four filled ones. That distinction survives any
     colour vision and any monitor, which a fifth pale step would not.
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

   **Agency groups** (`agency-groups.csv`) appear in the agency filter as checkboxes that tick or
   untick all their members at once. They are shortcuts over the same selection, not a second
   kind of filter: there is no group state, a group's checkbox is derived from its members
   (checked when all are selected, indeterminate when some are), and the selection stored is still
   just agency ids in roster order — so the strip-ordering guarantee above is untouched. Only
   members with intake data count; a group with none is not offered.
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

   Upload of replacement question tabs — Questions, Requirements and Question links, chosen
   together and each recognised by its header row, since exported file names are Google's —
   that the UI re-renders from immediately. All three are required: the snapshot holds no raw
   CSV to fill a gap with. The upload is a **session-only preview**: it is parsed entirely in the
   browser, held in memory, never sent anywhere, and discarded on reload. A malformed upload
   (unknown agency, missing columns or tabs, parse errors) surfaces the error and leaves the
   currently displayed dataset untouched. Making it permanent means editing the sheet or `/data`
   (Section 8). Upload replaces the **intake questions only** — agencies and capability data are
   always the published set, and the question/capability map is re-resolved against the uploaded
   questions.
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
   exists in the displayed dataset — because a question was deleted or its id changed, or because
   an uploaded preview drops it — is surfaced as an orphan, never silently reattached or hidden, per the rule
   in Section 4. Commenting is **optional at build time**: with `VITE_COMMENTS_ENDPOINT` unset the
   whole application renders normally with commenting simply absent, and a dead or misconfigured
   endpoint degrades to an error inside the comment areas alone. The analysis is the product;
   comments are an enhancement and may never delay, block, or blank it.
9. **Live data from a published Google Sheet**, so staff can update the data and have it visible
   without a rebuild. Optional at build time: `VITE_SHEET_PUBLISHED_URL` is the document's
   "Publish to web" link, and `src/sheetTabs.ts` maps each of the eight tabs to its `gid` (which
   `apps-script/SheetSetup.gs` prints). Unset URL = snapshot only. Constraints, each of which is
   easy to break:

   - **The page never waits on the sheet.** It paints from the committed snapshot and fetches the
     sheet after first paint, as comments do. Page load is unchanged; the sheet arrives
     ~0.5–2 s later.
   - **The sheet is validated as one dataset, by the build's own code** (`normalizeDataset`).
     Anything the build would reject — unknown agency or ID, missing column, duplicate ID, a
     second Requirements row for a pair, a value outside a dropdown — rejects the whole sheet; the
     page keeps the snapshot and states why, naming the tab and row. Never display part of a sheet, and never mix live tabs with snapshot
     ones: every tab resolves agency names against the live roster. A partial configuration (a
     URL with a tab not wired in `sheetTabs.ts`) is reported, not half-honoured.
   - **A data swap must not rebuild the page under a reader.** `render()` rebuilds everything, so
     a swap would collapse open cards and discard a half-written comment. An identical sheet
     only updates the status line in place; a different one is applied immediately only if the
     reader is idle (no open `<details>`, no focus inside `#app`), and otherwise offered behind a
     button. Filters survive a swap, minus agencies the new roster lacks.
   - **Requests stay CORS-simple** — a bare GET, no custom headers — for the same reason as the
     comment client.
   - **Freshness is bounded by Google, not by the app.** Published output is cached for about five
     minutes on Google's side.
   - **Only the eight data tabs are published.** The sheet's Checks and Instructions tabs are for
     editors; "Entire document" would publish them too.

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
- Unit tests for the normalization modules specifically: roster parsing and agency alias
  resolution, every per-tab rule (ID shape and uniqueness, dropdown values, one Requirements row
  per pair, proof detail only with proof required), links derived in both directions and
  unresolved-link detection, capability answers and survey status, recognising uploaded tabs by
  header, question/capability link resolution. `src/data/dataset.test.ts` asserts that the committed JSON
  is exactly what the committed CSVs normalize to, so a stale snapshot cannot ship, and
  `src/sheetSource.test.ts` covers the live loader's failure modes. This is the part of the system most likely to silently produce wrong output, and the
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
  client-side only and never leave the browser. Where a live sheet is configured, the browser
  reads its published CSV tabs directly from Google (Section 5, requirement 9) — read-only, no
  credentials, no server of ours in between. It is a separate spreadsheet from the comment store.
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

1. The eight CSVs (Section 2) checked into `/data/` — the sources of record, or the committed
   snapshot of the live sheet where one is configured (`npm run pull-sheet` refreshes them).
2. `scripts/build-data.ts` runs at build time, outputs `/src/data/questions.json` and
   `/src/data/capabilities.json`. It warns (without failing) when a question/capability map entry
   matches no question ID — the map is allowed to lag a question edit by one commit.
3. Vite builds static assets.
4. GitHub Actions workflow builds on push to `main` and deploys to GitHub Pages.
5. Updating the intake comparison going forward means editing the live sheet, where one is
   configured — no build involved — or otherwise editing the CSVs and re-running the build.
   The in-app upload (Section 5, requirement 6) is a session-only preview for trying a
   candidate revision — it does not persist anything; permanent changes still go through this
   pipeline. Building a live-editing interface remains out of scope (Section 10).

## 9. Repository Structure

```
/data/by-question.csv                 # original agency-survey export + deliberate additions; not read
/data/agencies.csv                    # tab: the agency roster, kinds, aliases, capability survey
/data/agency-groups.csv               # tab: named groups of agencies, one row per membership
/data/questions.csv                   # tab: questions, with stable IDs
/data/requirements.csv                # tab: one row per (question, agency): Asked, Verification, proof
/data/question-links.csv              # tab: one row per link between questions
/data/capabilities.csv                # tab: capabilities, with stable IDs
/data/provider-capabilities.csv       # tab: one row per provider answer
/data/question-capability-map.csv     # tab: editorial question -> capability claims
/scripts/build-data.ts                # thin CLI: reads the CSVs, writes the JSON via the shared modules
/scripts/pull-sheet.ts                # copies the live sheet into /data, validating first
/src/data/text.ts                     # string canonicalization shared by both normalizers
/src/data/tabs.ts                     # tab reading shared by all normalizers: columns, dropdowns, ID rule
/src/data/agencies.ts                 # agency roster parser + alias resolution
/src/data/agencies.test.ts
/src/data/dataset.ts                  # all eight tabs -> one dataset; the build and the live sheet both call it
/src/data/dataset.test.ts
/src/data/normalize.ts                # question tabs:   CSV text -> NormalizedData (+ upload tab detection)
/src/data/normalizeCapabilities.ts    # capability tabs: CSV text -> CapabilityData
/src/data/normalize.test.ts
/src/data/normalizeCapabilities.test.ts
/src/data/questions.json              # generated, committed
/src/data/capabilities.json           # generated, committed
/src/data/types.ts                    # the data contract
/src/summary.ts                       # standardization analysis (view over the data)
/src/capabilities.ts                  # capability variance analysis (view over the data)
/src/capabilities.test.ts
/src/app.render.test.ts               # whole-app render smoke test (happy-dom)
/src/sheetSource.ts                   # live Google Sheet loader (network I/O; validates via dataset.ts)
/src/sheetSource.test.ts
/src/sheetTabs.ts                     # the live sheet's tab gids (printed by SheetSetup.gs)
/src/comments/types.ts                # the comment data contract
/src/comments/client.ts               # transport to the Apps Script store (the only network write)
/src/comments/resolve.ts              # comments -> targets in the active dataset; orphan detection
/src/comments/resolve.test.ts
/src/comments/client.test.ts
/src/main.ts
/src/components/
/src/styles/
/apps-script/Comments.gs              # the comment store; deployed by hand, checked in for review
/apps-script/SheetSetup.gs            # data sheet guard rails: dropdowns, ID rules, Checks tab; run by hand
/apps-script/README.md                # how to deploy, moderate and set up both
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
- Editing the unified intake data through a UI **in this app**. Staff edit the Google Sheet, in
  Google's own interface; the app only ever reads it.

## 11. Open Decisions Requiring Confirmation

The following were assumed rather than confirmed, and building proceeds on these assumptions
unless corrected:

1. ~~**ORCA variants.**~~ — settled (October 2026) as an assumption: `ORCA`, `ORCA (Senior)`,
   `ORCA (Disabled)` and `ORCA LIFT` are distinct programs and separate agencies on the roster. If
   that ever proves wrong, the roster and every Requirements row naming them must change.
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
   by hand in the cleaned CSV and the assumption recorded in that row's `Data Quality Notes`.
   Links are now by ID (Section 2), so the matches are carried as rows of the Question links tab.
   If any of these three is wrong, delete or change that row.
6. **`SAP` is carried as its bare acronym** because the source never expands it. Confirm what it
   stands for before it appears in anything stakeholder-facing.
7. ~~**`Pierce SHUTTLE`**~~ — settled (October 2026). SHUTTLE is Pierce Transit's paratransit
   program, separate from Pierce Runner. It is on the roster as `Pierce Transit SHUTTLE` (a ride
   provider, aliases `Pierce SHUTTLE` and `SHUTTLE`), with no intake questions of its own and no
   capability survey, so the capabilities view lists it as never surveyed.
8. **`Community Van` is on the roster but has no intake data.** It has capability answers but asks
   no questions in the intake data. Rather than omit it, views
   that list agencies per question derive their population from the question data, so it does not
   appear as "does not ask" on every question; the capabilities coverage view names the gap
   explicitly instead. Confirm whether its intake questions simply weren't surveyed.
9. **Agency `kind` classification is an assumption.** `ORCA`, `ORCA (Senior)`, `ORCA (Disabled)`,
   `ORCA LIFT` and `SAP` are treated as fare/pass programs and `Metro Transit Instruction` as
   travel training, meaning vehicle capabilities are reported as "not applicable" rather than as a
   survey gap. The evidence is that the capability survey went to exactly the ride providers and
   none of these. If any of them does operate vehicles, correct `Kind` in the roster
   (`data/agencies.csv`, or the Agencies tab of the live sheet).
10. **The question → capability map is editorial.** Nothing in the other tabs asserts that
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
    both `by-question.csv` and the cleaned data as a question in its own right, which
    is why `by-question.csv` is described in Section 2 as a maintained question bank rather than
    a frozen export. Because the survey never asked it, it carries no requirement levels or proof
    burden and has no Requirements rows; the gap is in the survey, not in the sheet. It is
    recorded here so a later reader does not mistake the blank row for a parsing failure, and so
    the one open question stays visible: ask the agencies how they handle it, and the columns can
    be added.
14. **The live sheet's terms.** Assumed rather than confirmed:
    - *Published means public.* "Publish to web" makes each data tab readable by anyone with its
      URL, and the URLs ship in the bundle. This sharpens item 3: the data was already public on
      the deployed site, but staff now edit it in a public document, and should know that.
    - *"Publish to web" over other endpoints.* Chosen because it returns exactly what a download
      would and can expose only the eight data tabs. Its cost is the ~5-minute cache; the `gviz`
      endpoint is fresher but guesses column types and can silently blank cells, and `export`
      is not reliably readable cross-origin from a browser.
    - *Staff own the roster, including `Kind`.* Item 9's classification is now editable by
      whoever can edit the sheet, and a wrong `Kind` changes the capabilities analysis without
      any developer review.
    - *The snapshot is refreshed by hand* (`npm run pull-sheet`). Between refreshes, readers who
      act quickly are offered newer data rather than shown it. Automating the refresh is possible
      (a scheduled workflow) but not built.
    - *IDs are permanent by convention, not by force.* Rewording a question keeps its comments,
      because the ID is separate from the text (Section 4). Changing an ID still orphans them;
      the sheet warns before an ID is edited, but cannot forbid it.
15. **Decisions on the source data's contradictions and gaps** (decided October 2026; each
    recorded in the question's Data Quality Notes). Settled as assumptions, not
    confirmed with the agencies:
    - *ORCA on `Phone` is Optional.* The survey listed it as both Required and Optional.
    - *Income's proof belongs to ORCA LIFT,* not bare ORCA; only ORCA LIFT asks the question.
    - *ORCA and Access Paratransit ask "Is the disability temporary or permanent" as Required.*
      They demanded proof without saying they ask it; that they ask it was the decision, and
      Required was inferred from the proof demand.
    - *Homage TAP's ProviderOne "proof" is Self-attestation:* typing a number into a textbox is
      self-report, not documentary evidence.
    - *SAP's proof documents* on Household size, Selection of benefits program and Benefits ID
      number are recorded as "TBD".
    - *Still open:* bare `ORCA` on Email, Home address and Mailing address accepts
      self-attestation but has not said whether the question is required or optional. These rows
      are `Asked: Unknown`, which the app shows as "not stated".
    - *Links are shown from both ends* after the conversion to the sheet layout: of the 19 links,
      the export recorded 17 on one question only (e.g. `Accessibility needs` now lists the five
      questions that name it as upstream). The layout working as intended, not new data; if a link
      should not exist, delete its row.
16. **The two starter agency groups are a proposal.** "Paratransit providers" holds only Access
    Paratransit and Pierce Transit SHUTTLE, because those are the only agencies whose paratransit
    status the data states; others may belong. "ORCA programs" is every roster entry named ORCA.
    Hopelink staff should review both and add the groups they actually want before stakeholders
    see the filter.
