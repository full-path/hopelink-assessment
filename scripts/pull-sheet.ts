import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { normalizeDataset, type SourceTexts } from "../src/data/dataset";
import { fetchSheetTexts, readSheetConfig } from "../src/sheetSource";

// Copies the live Google Sheet into /data, so the snapshot the page paints first (and falls back
// to) catches up with what staff have edited. Run `npm run build-data` afterwards — or just
// `npm run build` — and commit both; the diff is the audit trail of what changed in the sheet.
//
// Reads the same VITE_SHEET_*_CSV_URL settings as the app, from the environment or .env.local.
// Validates before writing: a sheet the app would reject leaves /data untouched.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const FILES: Record<keyof SourceTexts, string> = {
  agencies: "agencies.csv",
  questions: "eligibility-questions.csv",
  capabilities: "capabilities.csv",
  capabilityMap: "question-capability-map.csv",
};

async function main(): Promise<void> {
  const config = readSheetConfig({ ...loadEnv("production", root, "VITE_SHEET_"), ...process.env });
  if (config.status === "disabled") {
    throw new Error("No sheet configured: set the VITE_SHEET_*_CSV_URL variables (see README).");
  }
  if (config.status === "misconfigured") {
    throw new Error(config.message);
  }

  const texts = await fetchSheetTexts(config.urls);
  // Google serves CRLF line endings; /data is LF. Converting keeps the git diff to real changes.
  // Safe inside quoted cells too, where a line break is content either way.
  for (const role of Object.keys(texts) as (keyof SourceTexts)[]) {
    texts[role] = texts[role].replace(/\r\n/g, "\n").replace(/\n?$/, "\n");
  }

  const { data, capabilities } = normalizeDataset(texts);

  for (const role of Object.keys(FILES) as (keyof SourceTexts)[]) {
    writeFileSync(resolve(root, "data", FILES[role]), texts[role]);
  }
  console.log(
    `Pulled ${String(data.agencies.length)} agencies, ${String(data.questions.length)} questions, ` +
      `${String(capabilities.profiles.length)} capability profiles into data/. ` +
      `Now run \`npm run build-data\` and review the diff.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
