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

No backend, no build-time secrets, no database: the CSVs in `/data` are normalized at build time
into typed JSON files that the static frontend loads as its default dataset. The same
normalization logic also runs in the browser, so a viewer can upload a replacement CSV and
preview it in place — see "Previewing a replacement CSV" below.

## The two views

| View                      | What it answers                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intake questions**      | Every unique question, who asks it and how strictly, its upstream/downstream chain, what it determines about a provider, and which agencies would have to change practice to standardize on it.                                                                 |
| **Provider capabilities** | Which capabilities actually differ between providers, the full provider × capability matrix, and who has and hasn't reported — distinguishing "surveyed and answered nothing" from "never surveyed" from "operates no vehicles, so the question doesn't apply". |

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
| `npm test`                        | Runs the normalization/analysis unit tests and the app render test (Vitest).   |
| `npm run lint`                    | ESLint, including type-aware rules.                                            |
| `npm run format` / `format:check` | Prettier write / check.                                                        |
| `npm run preview`                 | Serves the production build locally.                                           |

## Updating the data

There is no in-app _editing_ UI by design (see CLAUDE.md, Section 10). To permanently reflect a
change in agency intake practice:

1. Edit the relevant CSV in `/data` directly (see "Source files" below).
2. Run `npm run build-data` (or just `npm run dev` / `npm run build`, which do this automatically).
3. Commit both the CSV change and the regenerated JSON in `src/data/`.

### Source files

| File                               | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/eligibility-questions.csv`   | The intake questions — source of record. Cleaned from `data/by-question.csv`, the raw agency-survey export, which is kept unmodified so the cleanup is auditable.                                                                                                                                                                                                                                                                                                         |
| `data/capabilities.csv`            | One row per ride provider, one column per capability. Answers are free text; the normalizer maps them to `yes` / `no` / `conditional` / `unknown` and keeps the agency's own wording as a qualifier. **A blank cell means `unknown`, never `no`** — three agencies returned an entirely blank row.                                                                                                                                                                        |
| `data/question-capability-map.csv` | Which question exists to determine which capability. This is an _editorial_ claim — nothing in the other two files asserts it — so each row carries a `Note` explaining the reasoning, and the file lives in `/data` rather than in code so a non-developer can review it. Capability names must match a column header of `capabilities.csv` exactly, or the build fails. Question text must match a `Question` cell exactly, or the build warns and the link is dropped. |

### Previewing a replacement CSV in the app

The running app has a "Preview a replacement CSV" control at the top of the page. Choosing a CSV
file (same columns as described below) re-renders the whole UI — list, filters, link resolution,
standardization summaries — from that file instead of the bundled data.

- The file is parsed **entirely in the browser** and never uploaded anywhere; there is no server.
- The preview lasts only for the current session and is discarded on reload. "Reset to bundled
  data" returns to the committed dataset immediately.
- A file that fails normalization (unknown agency name, missing columns, malformed CSV) shows the
  error and leaves the currently displayed data untouched — the same strictness the build step
  applies, from the same shared code (`src/data/normalize.ts`).
- Upload replaces the **intake questions only**. Capability data stays the committed set, and the
  question/capability map is re-resolved against the uploaded questions: links whose question text
  no longer matches are reported at the top of the Provider capabilities view rather than silently
  vanishing.

Use this to sanity-check a CSV revision with stakeholders before committing it; committing it
(steps above) is still what makes it permanent.

### CSV shape

`data/eligibility-questions.csv` has one row per unified question:

| Column                            | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Question`                        | Intake question text. Its normalized form is the source of the question's stable id — do not casually reword an existing question if you want its id to stay stable.                                                                                                                                                                                                                                                                                                                                 |
| `Providers Required`              | Comma-separated agencies for which the question is mandatory.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Providers Optional`              | Comma-separated agencies for which it's asked but optional.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Providers Self Attestation`      | Comma-separated agencies accepting the applicant's word with no proof.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Providers Burden of Proof`       | Semicolon-separated `Agency (proof detail)` entries. Semicolons, not commas, separate entries here specifically because proof detail text routinely contains commas of its own (e.g. `ORCA (ProviderOne number OR EBT number OR DSHS Client ID number)`).                                                                                                                                                                                                                                            |
| `Upstream Q's` / `Downstream Q's` | The **exact text** of another row's `Question` cell that gates this one. A cell may name several questions, separated by semicolons (commas are unsafe here too — question text contains them, e.g. `Special directions (gate code, etc)`). Text that doesn't exactly match another `Question` cell is preserved and surfaced in the UI as an unresolved link rather than silently dropped — the normalization script does not fuzzy-match or paraphrase-match, by design (see CLAUDE.md Section 3). |
| `Data Quality Notes`              | Free text, optional. Anything here is carried through verbatim and shown in the UI next to the question it annotates. Use it to flag things a human should double check (contradictory cells, ambiguous references) rather than silently editing the four columns above.                                                                                                                                                                                                                             |

An agency name not already in `CANONICAL_AGENCIES` (`src/data/agencies.ts`) fails the build — and
is rejected by the in-app upload preview — rather than being silently mis-parsed. Add it to that
table (with any alias spellings you want tolerated) before it will parse. That roster is shared by
all three CSVs, so `SG VTS` in the capabilities sheet and `Sound Generations VTS` in the intake
sheet resolve to the same agency.

Each agency also carries a `kind` — `ride_provider`, `fare_program`, or `travel_training`. It
exists so the capabilities view can tell "this provider was never surveyed" apart from "this is a
fare program and has no vehicles to describe". Set it when you add an agency.

## Testing

```bash
npm test
```

Covers the part of the system most likely to silently produce wrong output:

- **Normalization** — agency alias resolution, comma vs. semicolon splitting in the
  requirement/proof columns, slug generation, upstream/downstream link resolution (including the
  case where a reference legitimately fails to resolve and must be flagged rather than dropped),
  capability value parsing, and question/capability link resolution against a changed question set.
- **Analysis** (`src/capabilities.test.ts`) — the variance verdicts, and specifically that blank
  answers can never turn a uniform capability into a varying one or vice versa.
- **Render** (`src/app.render.test.ts`) — mounts the whole app against the committed data in
  `happy-dom` and drives both tabs and the filters. Because the UI is hand-rolled DOM, a throw
  inside `render()` produces a blank page that every other test would still pass.

## Architecture notes

- **No framework.** The UI is plain TypeScript + DOM, using a ~30-line `h()` hyperscript helper
  (`src/dom.ts`) instead of hand-built HTML strings. The filterable-list-with-detail-panels shape
  of this app didn't warrant introducing Preact, state management, or routing.
- **Shared normalization layer.** All CSV parsing and cleanup lives under `src/data/`, deliberately
  free of Node imports so it runs in two places: `scripts/build-data.ts` (a thin CLI wrapper that
  generates the committed JSON) and the in-browser upload preview in `src/main.ts`. This is why
  `papaparse` is a runtime dependency shipped in the client bundle rather than a dev-only tool.
  `normalize.ts` (questions) and `normalizeCapabilities.ts` (capabilities) are siblings with no
  dependency between them; what they share — the agency roster and string canonicalization — lives
  in `agencies.ts` and `text.ts`.
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
    answer as a "no".
- **Committed JSON.** `src/data/questions.json` and `src/data/capabilities.json` are committed, not
  generated fresh in CI from a build secret, since the CSVs are plaintext committed sources of
  record — aggregate policy metadata, not rider PII.

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
