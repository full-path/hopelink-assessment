import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCsv } from "../src/data/normalize";

// Thin CLI wrapper around the shared normalization module (src/data/normalize.ts):
// reads the source-of-record CSV, writes the committed questions.json the frontend
// loads as its default dataset.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV_PATH = resolve(__dirname, "../data/eligibility-questions.csv");
const DEFAULT_OUTPUT_PATH = resolve(__dirname, "../src/data/questions.json");

function main(): void {
  const csvText = readFileSync(DEFAULT_CSV_PATH, "utf-8");
  const data = normalizeCsv(csvText);
  writeFileSync(DEFAULT_OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(
    `Wrote ${String(data.questions.length)} questions and ${String(data.agencies.length)} agencies to ${DEFAULT_OUTPUT_PATH}`,
  );
}

main();
