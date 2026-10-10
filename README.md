# Find a Ride — Unified Intake Explorer

A static, client-side tool that turns the per-agency intake questions asked across Central Puget
Sound specialized-transportation agencies into a single de-duplicated list — showing which
agencies require, treat as optional, self-attest, or demand documentary proof for each question,
and where practice already lines up well enough to standardize.

It also cross-references those questions against what each provider can physically accommodate
(wheelchairs, lifts, oxygen, interpretation), which is what makes the standardization case
concrete: a capability every provider offers equally cannot route a rider anywhere, so a question
about it does no work — while a capability that differs between providers, asked about by only one
of them, is the strongest candidate for a shared intake question.

The data can live in a published Google Sheet that program staff edit directly: the page paints
at once from a snapshot compiled into the build, then fetches the sheet in the background and
switches to it, so an edit shows up on the next page load without a rebuild. See "Live data from
a Google Sheet" below. The snapshot is the CSVs in `/data`, normalized at build time into typed
JSON files; with no sheet configured, that snapshot is simply the data. The same normalization logic also runs in the browser, so a viewer
can upload a replacement CSV and preview it in place. That control is currently hidden — see
"Previewing a replacement CSV" below for how to turn it back on.

Readers can also leave comments on an individual question or capability. That is the one part of
the system that persists anything, and it is optional: with no comment endpoint configured the
site builds, deploys, and works exactly as it did before, minus the comment boxes. See
"Comments" below.

## The two views

| View                      | What it answers                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intake questions**      | Every unique question, how many agencies ask it, a per-agency strip showing each one's requirement level at a glance, who asks it and how strictly, its upstream/downstream chain, what it determines about a provider, and which agencies would have to change practice to standardize on it. |
| **Provider capabilities** | Which capabilities actually differ between providers, the full provider × capability matrix, and who has and hasn't reported — distinguishing "surveyed and answered nothing" from "never surveyed" from "operates no vehicles, so the question doesn't apply".                                |

## Requirements

- Node.js 20+

## Getting started

```bash
npm install
npm run dev
```

This regenerates `src/data/questions.json` and `src/data/capabilities.json` from the CSVs and
starts the Vite dev server.

## Scripts

| Command                           | What it does                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                     | Rebuilds the data JSON, then starts the dev server.                            |
| `npm run build`                   | Rebuilds data, type-checks, and produces a static production build in `dist/`. |
| `npm run build-data`              | Runs only the CSV → JSON normalization step (`scripts/build-data.ts`).         |
| `npm run pull-sheet`              | Copies the live Google Sheet into `/data`, validating it first.                |
| `npm test`                        | Runs the normalization/analysis unit tests and the app render test (Vitest).   |
| `npm run lint`                    | ESLint, including type-aware rules.                                            |
| `npm run format` / `format:check` | Prettier write / check.                                                        |
| `npm run preview`                 | Serves the production build locally.                                           |

## Updating the data

There is no in-app _editing_ UI by design (see CLAUDE.md, Section 10). The editing surface is
either the Google Sheet or the CSVs, which have the same seven tabs and columns.

**With a live sheet configured** (the normal case once it is set up): edit the sheet, following
its private Instructions tab, and check its Checks tab reads 0 throughout. Readers see the change
on their next page load, within a few minutes (see "How fresh is it?" below). Every so often a
developer refreshes the snapshot:

1. `npm run pull-sheet` — copies the seven tabs into `/data`, refusing if the sheet would not load.
2. `npm run build-data` — regenerates the JSON in `src/data/`.
3. Review the diff and commit both. The git history is the audit trail of what changed in the sheet;
   the sheet's own version history covers the edits in between.

**With no sheet configured**:

1. Edit the relevant CSV in `/data` directly (see "The data layout" below).
2. Run `npm run build-data` (or just `npm run dev` / `npm run build`, which do this automatically).
3. Commit both the CSV change and the regenerated JSON in `src/data/`.

### The data layout

One file per sheet tab, one value per cell. Anything that refers to another tab does so by a
stable ID (or, for agencies, by name), which the sheet offers as a dropdown. Extra columns are
ignored, so the sheet can carry helper columns — a lookup showing the question text beside an ID,
say — without the app caring.

| File / tab                                                       | Columns                                                          | Notes                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/agencies.csv` — **Agencies**                               | `Agency`, `Kind`, `Aliases`, `Capability survey`, `Note`         | The roster; see "The agency roster" below.                                                                                                                                                                                                                                                                                      |
| `data/questions.csv` — **Questions**                             | `ID`, `Question`, `Data Quality Notes`                           | One row per unified question, in display order. **`ID` is assigned once and never changed**: comments on the site are attached to it. Rewording `Question` is safe. `Data Quality Notes` is shown in the app beside the question; use it to flag things a human should double-check.                                            |
| `data/requirements.csv` — **Requirements**                       | `Question ID`, `Agency`, `Asked`, `Verification`, `Proof detail` | One row per question and agency that asks it, and never two. `Asked` is `Required`, `Optional`, or `Unknown` when the agency has not said — never blank. `Verification` is `Self-attestation`, `Proof required`, or blank; an `Unknown` row needs one. `Proof detail` (what documents are accepted) only with `Proof required`. |
| `data/question-links.csv` — **Question links**                   | `Question ID`, `Leads to`, `Note`                                | One row per link, from the question asked first to the one it leads to. The app shows it from both ends. A link to an ID that does not exist is shown as unresolved, not dropped (CLAUDE.md §11 item 2).                                                                                                                        |
| `data/capabilities.csv` — **Capabilities**                       | `ID`, `Label`                                                    | One row per provider capability. Same rule as questions: the ID is permanent, the label can be reworded.                                                                                                                                                                                                                        |
| `data/provider-capabilities.csv` — **Provider capabilities**     | `Agency`, `Capability ID`, `Answer`, `Agency's wording`          | One row per answer. `Answer` is `Yes`, `No` or `Conditional` (any hedged answer). `Agency's wording` keeps what the agency actually said ("Depends on vehicle", "1"). **A missing row means `unknown`, never `no`.** Only agencies whose roster row says `Returned` may have answers.                                           |
| `data/question-capability-map.csv` — **Question-capability map** | `Question ID`, `Capability ID`, `Note`                           | Which question exists to determine which capability. An _editorial_ claim — nothing in the other tabs asserts it — so each row's `Note` gives the reasoning. An unknown capability fails; an unknown question is reported in the Provider capabilities view and the build warns.                                                |

`data/by-question.csv` is the original agency-survey export the first version of this data was
cleaned from. It is kept for the record and is not read by the app or published to the sheet.

### The agency roster

`data/agencies.csv` (the **Agencies** tab) is the one place agency naming is reconciled. An agency
name that is not on it — as a name or an alias — fails the build and is rejected by the live sheet
loader and the upload preview, rather than being silently mis-parsed.

| Column              | Content                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Agency`            | The display name. The agency's id is derived from it, so it must be unique (ignoring case and punctuation). Other tabs refer to agencies by this name.                                                                                                                         |
| `Kind`              | `Ride provider`, `Fare program`, or `Travel training`. It is how the capabilities view tells "this provider was never surveyed" apart from "this is a fare program and has no vehicles to describe". Anything else is rejected.                                                |
| `Aliases`           | Optional. Other spellings to accept, separated by semicolons (`SG VTS; Sound Generations`). Matching ignores case and extra spaces, so `Beyond the borders` needs no alias — but an alias claimed by two agencies is an error. Keep the old name here when renaming an agency. |
| `Capability survey` | `Returned`, or blank if the agency was never surveyed. Stated rather than inferred, so "returned the survey blank" and "never surveyed" stay distinguishable.                                                                                                                  |
| `Note`              | Optional, for editors only; not shown in the app. Records why a row is the way it is.                                                                                                                                                                                          |

To add an agency, add a row here first, then pick it in the other tabs.

### Previewing replacement CSVs in the app

**This control is hidden by default.** Build or run with `VITE_SHOW_CSV_UPLOAD=true` to show it:

```bash
echo 'VITE_SHOW_CSV_UPLOAD=true' >> .env.local   # already gitignored
npm run dev
```

Only the affordance is hidden — the upload path itself is intact, wired up, and covered by
tests, so turning it on needs no code change.

With it enabled, the app has a "Preview replacement CSVs" control at the top of the page. Choose
the **Questions, Requirements and Question links** tabs together, exported as CSV (in any order,
named anything — each is recognised by its header row), and the whole UI re-renders from them.

- The files are parsed **entirely in the browser** and never uploaded anywhere; there is no server.
  Agency names are resolved against the roster currently in use (the live sheet's, if it loaded).
- The preview lasts only for the current session and is discarded on reload. "Reset to published
  data" returns to the live sheet, or to the snapshot if the sheet is not in use.
- Files that fail normalization show the error and leave the currently displayed data untouched —
  the same strictness the build step applies, from the same shared code (`src/data/normalize.ts`).
- Upload replaces the **intake questions only**. Agencies and capability data stay the published
  set, and the question/capability map is re-resolved against the uploaded questions: links whose
  question no longer exists are reported at the top of the Provider capabilities view rather than
  silently vanishing.

## Live data from a Google Sheet

The app can read its data from a Google Sheet that staff edit, instead of only from the snapshot
built into the site. It is optional: with no sheet configured the site works exactly as it always
has.

### How it behaves

- **The page never waits for the sheet.** It paints immediately from the snapshot, then fetches
  the seven tabs in the background. Page load time is unchanged; the sheet adds roughly 0.5–2
  seconds _after_ first paint, and about 10 KB of transfer.
- **If the sheet matches the snapshot**, only the status line under the header changes.
- **If it differs and the reader is idle**, the page switches to it at once, keeping their filters.
- **If it differs and the reader is busy** — a question card open, or focus inside the page (typing
  a comment, using a filter) — the page offers a "Show the latest data" button rather than
  rebuilding the page under them.
- **If the sheet is unreachable or invalid**, the page keeps the snapshot and says so, with the
  reason — naming the tab and row, e.g. "Requirements tab, row 14: unknown Question ID". The sheet
  is checked by the same code as a build (`normalizeDataset` in `src/data/dataset.ts`), and is
  accepted or rejected as a whole — the page never shows half a sheet.

### How fresh is it?

Google caches published output for about five minutes, so an edit typically appears within five
minutes, not instantly. Nothing in the app can shorten that.

### Setting it up

1. **Create the spreadsheet** — a new one, separate from the comment store. Import each CSV in
   `/data` (except `by-question.csv`) as its own tab: File → Import → Upload → "Insert new
   sheet(s)", then rename the tab:

   | Tab name                  | Import                             |
   | ------------------------- | ---------------------------------- |
   | `Agencies`                | `data/agencies.csv`                |
   | `Questions`               | `data/questions.csv`               |
   | `Requirements`            | `data/requirements.csv`            |
   | `Question links`          | `data/question-links.csv`          |
   | `Capabilities`            | `data/capabilities.csv`            |
   | `Provider capabilities`   | `data/provider-capabilities.csv`   |
   | `Question-capability map` | `data/question-capability-map.csv` |

2. **Add the guard rails.** Extensions → Apps Script, paste in `apps-script/SheetSetup.gs`, and
   run `setupSheet`. It adds the dropdowns, ID rules, red highlighting of invalid rows, and the
   private **Checks** and **Instructions** tabs (see `apps-script/README.md`). It finishes by
   logging a filled-in `SHEET_TABS` block (View → Logs).

3. **Wire up the tabs.** Paste that block into `src/sheetTabs.ts` and commit it. The gids it
   contains identify the tabs and never change while the spreadsheet is in use.

4. **Publish the seven data tabs.** File → Share → Publish to web → under "Link", choose the data
   tabs only (**not** "Entire document", and not Checks or Instructions), format **Comma-separated
   values (.csv)**, and publish. Under "Published content and settings" leave **Automatically
   republish when changes are made** ticked. Copy the link — it looks like
   `https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?output=csv`; any query string is fine.

   Publishing makes those tabs readable by anyone with the link, and the link ships in the site's
   JavaScript. Who can _edit_ is controlled separately, by the spreadsheet's normal sharing.

5. **Point the site at it.** Set the link as the `SHEET_PUBLISHED_URL` repository **variable**
   (Settings → Secrets and variables → Actions → Variables — not a secret, since it ends up in the
   public bundle), then re-run the deploy workflow. For local development, put
   `VITE_SHEET_PUBLISHED_URL=…` in `.env.local`, which `npm run pull-sheet` also reads.

   With the link set but a tab not wired in `src/sheetTabs.ts`, the page shows the snapshot and
   reports which tab is missing, rather than mixing live tabs with snapshot ones.

### Keeping the snapshot current

The snapshot is what every reader sees first, so if it falls far behind the sheet, readers who
open a card quickly are offered the update instead of getting it automatically. Run
`npm run pull-sheet` (see "Updating the data") whenever the sheet has settled after a round of
edits. `src/data/dataset.test.ts` fails if the committed JSON does not match the CSVs in `/data`,
so a pulled-but-not-rebuilt snapshot cannot ship.

## Comments

Readers can comment on any individual intake question (in the Intake questions view) or any
capability (in the Provider capabilities view). Comments are stored in a Google Sheet behind a
Google Apps Script web app.

**Setup, moderation, and the operational caveats are in [`apps-script/README.md`](apps-script/README.md).**
The script itself is checked in at `apps-script/Comments.gs`; it holds no secret.

The design in one paragraph: the Sheet was chosen over a database because this project already
treats hand-editable tabular files as its sources of record, and because the people who moderate
comments — Hopelink program staff — work in spreadsheets rather than in dashboards. If comments
ever need to become permanent annotations, the sheet exports to CSV and joins `/data`.

### What a developer needs to know

- **Commenting is optional at build time.** `src/main.ts` reads `VITE_COMMENTS_ENDPOINT`; when it
  is unset, `createCommentsClient` returns `null` and commenting is off. That is a supported
  state, not a broken one — local development and the test suite both run that way, and `npm test`
  makes no network request. A dead or misconfigured endpoint degrades to an error inside the
  comment areas only. **The analysis is the product; comments must never delay, block, or blank
  it.**
- **The POST must stay a CORS "simple request"** — `Content-Type: text/plain;charset=utf-8`, no
  custom headers. Apps Script web apps do not answer `OPTIONS` preflight, so an
  `application/json` POST is rejected by the browser before it is ever sent, and the failure
  surfaces as a generic network error that points nowhere near the cause. `src/comments/client.ts`
  documents this at the call site and `client.test.ts` asserts it.
- **Every Apps Script response is HTTP 200.** `ContentService` cannot set a status code, so
  failure is signalled by an `error` key in the JSON body. The client checks for it _before_ it
  checks `response.ok`.
- **The POST reply cannot be trusted to carry `doPost`'s output, and a successful write can look
  like a failure.** Following Apps Script's 302 yields `doPost`'s JSON, or a 404, or `doGet`'s
  comment list — and `doPost` has already appended the row in all three cases. So `client.ts`
  treats the reply as advisory: an `error` key is believed outright (only `doPost` emits one), a
  returned comment list is searched for the comment just sent, and anything else triggers a fresh
  GET, which is reliable. Found means success; absent means genuine rejection. This is why
  posting sometimes costs two round trips. The HTTP status is not consulted at all — every Apps
  Script reply is 200, so it carries no information.
- **Reads are retried; writes never are.** The same unreliable redirect affects GET, and a
  transient 404 there would replace every comment on the page with an error, so `list()` retries
  a few times with a short backoff. `post()` does not retry under any circumstance — a
  failed-looking write may already have appended the row, so a retry would duplicate comments
  rather than recover anything. It confirms by re-reading instead.
- **The passphrase is never compiled into the bundle.** Anything in a `VITE_*` variable ships in
  plaintext, which would make the gate decorative. The reader types it; it is remembered in
  `localStorage` and cleared automatically when the server rejects it.
- **A comment whose target no longer exists is shown as an orphan**, not dropped and not
  reattached. Question ids are slugs of question text, so rewording a question in the CSV — or
  uploading a preview that renames it — breaks the link. This is the same discipline the app
  already applies to unresolved upstream/downstream references and unmatched question/capability
  links (CLAUDE.md §4).
- **`src/components/commentThread.ts` renders the only stored user-generated content in the app.**
  Everything reaches the DOM through `h()` and `Node.append()`, which create text nodes. Do not
  introduce `innerHTML` or any raw-HTML sink in that file.

### Known limits

Stated plainly because they are design decisions, not oversights:

- The endpoint is **public** — its URL is visible in the site's JavaScript. The shared passphrase
  raises the cost of drive-by spam but is reusable and shared; it is a gate, not authentication.
  The sheet's `Hidden` column is the remedy if something unwanted gets through.
- Comments are **append-only from the app**. Editing, hiding, and deleting all happen in the
  sheet. There is no threading and there are no notifications — those need real accounts, and this
  deployment has none.
- Comments are attributable free text typed by agency staff. They are not rider PII, but they are
  on-the-record statements about an agency's own practice. See CLAUDE.md §11 item 11.

## Testing

```bash
npm test
```

Covers the part of the system most likely to silently produce wrong output:

- **Normalization** — roster parsing and agency alias resolution; every per-tab rule (ID shape and
  uniqueness, dropdown values, one Requirements row per question and agency, proof detail only
  with proof required); links derived in both directions, including a link to a missing question,
  which must be flagged rather than dropped; capability answers and survey status; recognising
  uploaded tabs by header; and question/capability link resolution against a changed question set.
- **Live sheet** (`src/sheetSource.test.ts`, `src/data/dataset.test.ts`) — that the seven tabs are
  validated as one dataset against the sheet's own roster, that each failure (unpublished tab, HTTP
  error, timeout, invalid data) names the tab and rejects the whole sheet, and that the committed
  JSON matches the committed CSVs.
- **Analysis** (`src/capabilities.test.ts`) — the variance verdicts, and specifically that blank
  answers can never turn a uniform capability into a varying one or vice versa.
- **Comments** (`src/comments/`) — `resolve.test.ts` covers target grouping and orphan detection,
  including the case that matters most: a comment whose question has gone (deleted, or its ID
  changed) must be orphaned visibly, not reattached to a neighbour. The render test covers the
  converse — rewording a question in the sheet keeps its comments, because the ID is stable. `client.test.ts` covers the wire contract, notably that the POST
  stays a CORS _simple request_ (see "Comments" below for why that is load-bearing).
- **Render** (`src/app.render.test.ts`) — mounts the whole app against the committed data in
  `happy-dom` and drives both tabs, the filters, the comment thread, and the live-sheet swap
  (applied when idle, offered when a card is open, snapshot kept on failure). Because the UI is
  hand-rolled DOM, a throw inside `render()` produces a blank page that every other test would
  still pass. It also asserts that a comment body containing markup renders as literal text —
  comment bodies are the only _stored_ user-generated content here, so that is the difference
  between an escaping bug and stored XSS.

## Architecture notes

- **No framework.** The UI is plain TypeScript + DOM, using a ~30-line `h()` hyperscript helper
  (`src/dom.ts`) instead of hand-built HTML strings. The filterable-list-with-detail-panels shape
  of this app didn't warrant introducing Preact, state management, or routing.
- **Shared normalization layer.** All CSV parsing and cleanup lives under `src/data/`, deliberately
  free of Node imports so it runs in three places: `scripts/build-data.ts` (a thin CLI wrapper that
  generates the committed JSON), the live sheet loader (`src/sheetSource.ts`), and the in-browser
  upload preview in `src/main.ts`. A whole dataset — all seven tabs — goes through one function,
  `normalizeDataset` in `src/data/dataset.ts`, so the sheet and the build cannot disagree about
  what is valid. This is why
  `papaparse` is a runtime dependency shipped in the client bundle rather than a dev-only tool.
  `normalize.ts` (questions) and `normalizeCapabilities.ts` (capabilities) are siblings with no
  dependency between them; what they share — the agency roster parser and resolver, the tab
  helpers (header and column checks, dropdown matching, the ID rule), and string canonicalization
  — lives in `agencies.ts`, `tabs.ts` and `text.ts`. The roster itself is data
  (`data/agencies.csv`), passed into both normalizers rather than imported.
- **Data contract.** `src/data/types.ts` is the single interface between normalization and the
  rendering code. UI components never see a raw CSV row.
- **Derived analysis is kept out of the data contract**, as pure functions in the frontend, since
  it is a view over the data rather than a fact about it:
  - **Standardization summary** (`src/summary.ts`): for each question, proposes the requirement
    level most agencies already use, then classifies every agency as already compatible, needing a
    practice change, or not currently asking the question at all — "what would standardizing this
    actually cost each agency?"
  - **Capability variance** (`src/capabilities.ts`): whether a capability differs across the
    providers that answered, and therefore whether the question behind it distinguishes providers
    at all. A question is flagged as a _unified intake candidate_ when its capability varies **and**
    fewer than half of ride providers currently ask about it — the agencies not asking still need
    that answer to route a rider. Verdicts require at least two responses, and never treat a blank
    answer as a "no". The flag appears in the question's capability panel and as a list filter,
    not as a header badge — it is a claim that needs its one-sentence justification beside it.
- **Committed JSON.** `src/data/questions.json` and `src/data/capabilities.json` are committed, not
  generated fresh in CI from a build secret, since the CSVs are plaintext committed snapshots —
  aggregate policy metadata, not rider PII. The live sheet, where configured, is published and
  public in the same sense.

## Open items carried over from CLAUDE.md

See CLAUDE.md Section 11 for assumptions this build proceeds on that still need stakeholder
confirmation — ORCA program variants treated as distinct agencies, unresolved links shown rather
than hidden, JSON committed to the repo, the `ride_provider` / `fare_program` classification, and
in particular the editorial question → capability map, which is a set of human claims rather than
anything either source sheet asserts.

## Deployment

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on every push to `main`.
It runs lint, tests, and the type-checked build before deploying — a red build never reaches Pages.
The Vite `base` is set to `./` (relative) so the build doesn't need to know the GitHub repo name in
advance.

To enable Pages for this repo: **Settings → Pages → Source → GitHub Actions** (one-time, done by a
repo admin in the GitHub UI — not something this workflow file can do on its own).

The workflow passes `VITE_COMMENTS_ENDPOINT` from the `COMMENTS_ENDPOINT` repository **variable**
(Settings → Secrets and variables → Actions → Variables). If it is unset the build still succeeds
and deploys — commenting is simply absent from the deployed site. The `SHEET_PUBLISHED_URL`
variable works the same way (see "Live data from a Google Sheet"): unset, the site shows the
snapshot only. Changing the sheet does not need a deploy; changing which sheet does.
