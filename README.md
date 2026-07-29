# Find a Ride — Unified Intake Explorer

A static, client-side tool that turns the per-agency intake questions asked across Central Puget
Sound specialized-transportation agencies into a single de-duplicated list — showing which
agencies require, treat as optional, self-attest, or demand documentary proof for each question,
and where practice already lines up well enough to standardize.

No backend, no build-time secrets, no database: the CSV in `/data` is normalized at build time
into a typed JSON file that the static frontend loads as its default dataset. The same
normalization logic also runs in the browser, so a viewer can upload a replacement CSV and
preview it in place — see "Previewing a replacement CSV" below.

## Requirements

- Node.js 20+

## Getting started

```bash
npm install
npm run dev
```

This regenerates `src/data/questions.json` from the CSV and starts the Vite dev server.

## Scripts

| Command                           | What it does                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                     | Rebuilds the data JSON, then starts the dev server.                            |
| `npm run build`                   | Rebuilds data, type-checks, and produces a static production build in `dist/`. |
| `npm run build-data`              | Runs only the CSV → JSON normalization step (`scripts/build-data.ts`).         |
| `npm test`                        | Runs the normalization module's unit tests (Vitest).                           |
| `npm run lint`                    | ESLint, including type-aware rules.                                            |
| `npm run format` / `format:check` | Prettier write / check.                                                        |
| `npm run preview`                 | Serves the production build locally.                                           |

## Updating the data

There is no in-app _editing_ UI by design (see CLAUDE.md, Section 10). To permanently reflect a
change in agency intake practice:

1. Edit `data/eligibility-questions.csv` directly.
2. Run `npm run build-data` (or just `npm run dev` / `npm run build`, which do this automatically).
3. Commit both the CSV change and the regenerated `src/data/questions.json`.

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

Use this to sanity-check a CSV revision with stakeholders before committing it; committing it
(steps above) is still what makes it permanent.

### CSV shape

`data/eligibility-questions.csv` has one row per unified question:

| Column                            | Content                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Question`                        | Intake question text. Its normalized form is the source of the question's stable id — do not casually reword an existing question if you want its id to stay stable.                                                                                                                                                              |
| `Providers Required`              | Comma-separated agencies for which the question is mandatory.                                                                                                                                                                                                                                                                     |
| `Providers Optional`              | Comma-separated agencies for which it's asked but optional.                                                                                                                                                                                                                                                                       |
| `Providers Self Attestation`      | Comma-separated agencies accepting the applicant's word with no proof.                                                                                                                                                                                                                                                            |
| `Providers Burden of Proof`       | Semicolon-separated `Agency (proof detail)` entries. Semicolons, not commas, separate entries here specifically because proof detail text routinely contains commas of its own (e.g. `ORCA (ProviderOne number OR EBT number OR DSHS Client ID number)`).                                                                         |
| `Upstream Q's` / `Downstream Q's` | The **exact text** of another row's `Question` cell that gates this one. Text that doesn't exactly match another `Question` cell is preserved and surfaced in the UI as an unresolved link rather than silently dropped — the normalization script does not fuzzy-match or paraphrase-match, by design (see CLAUDE.md Section 3). |
| `Data Quality Notes`              | Free text, optional. Anything here is carried through verbatim and shown in the UI next to the question it annotates. Use it to flag things a human should double check (contradictory cells, ambiguous references) rather than silently editing the four columns above.                                                          |

An agency name not already in `CANONICAL_AGENCIES` (`src/data/normalize.ts`) fails the build — and
is rejected by the in-app upload preview — rather than being silently mis-parsed. Add it to that
table (with any alias spellings you want tolerated) before it will parse.

## Testing

```bash
npm test
```

Covers the part of the system most likely to silently produce wrong output: agency alias
resolution, comma vs. semicolon splitting in the requirement/proof columns, slug generation, and
upstream/downstream link resolution (including the case where a reference legitimately fails to
resolve and must be flagged rather than dropped).

## Architecture notes

- **No framework.** The UI is plain TypeScript + DOM, using a ~30-line `h()` hyperscript helper
  (`src/dom.ts`) instead of hand-built HTML strings. The filterable-list-with-detail-panels shape
  of this app didn't warrant introducing Preact, state management, or routing.
- **Shared normalization module.** All CSV parsing and cleanup lives in `src/data/normalize.ts`,
  which is deliberately free of Node imports so it runs in two places: `scripts/build-data.ts`
  (a thin CLI wrapper that generates the committed `questions.json`) and the in-browser upload
  preview in `src/main.ts`. This is why `papaparse` is a runtime dependency shipped in the client
  bundle rather than a dev-only tool.
- **Data contract.** `src/data/types.ts` is the single interface between normalization and the
  rendering code. UI components never see a raw CSV row.
- **Standardization summary** (`src/summary.ts`): for each question, proposes the requirement
  level most agencies already use, then classifies every agency as already compatible, needing a
  practice change, or not currently asking the question at all. This is the piece of derived logic
  that answers the core stakeholder question ("what would standardizing this actually cost each
  agency?") and is deliberately kept in the frontend, not the data contract, since it's a view over
  the data rather than a fact about it.
- **`src/data/questions.json` is committed**, not generated fresh in CI from a build secret, since
  the CSV itself is a plaintext, committed source of record — aggregate policy metadata, not rider
  PII.

## Open items carried over from CLAUDE.md

See CLAUDE.md Section 11 for assumptions this build proceeds on (ORCA program variants treated as
distinct agencies, unresolved links shown rather than hidden, JSON committed to the repo) that
still need stakeholder confirmation.

## Deployment

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on every push to `main`.
It runs lint, tests, and the type-checked build before deploying — a red build never reaches Pages.
The Vite `base` is set to `./` (relative) so the build doesn't need to know the GitHub repo name in
advance.

To enable Pages for this repo: **Settings → Pages → Source → GitHub Actions** (one-time, done by a
repo admin in the GitHub UI — not something this workflow file can do on its own).
