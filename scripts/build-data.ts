import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCsv } from "../src/data/normalize";
import {
  normalizeCapabilitiesCsv,
  resolveQuestionCapabilityLinks,
} from "../src/data/normalizeCapabilities";

// Thin CLI wrapper around the shared normalization modules (src/data/normalize.ts and
// src/data/normalizeCapabilities.ts): reads the source-of-record CSVs and writes the committed
// JSON the frontend loads as its default dataset.

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataFile = (name: string) => resolve(__dirname, "../data", name);
const outputFile = (name: string) => resolve(__dirname, "../src/data", name);

function main(): void {
  const data = normalizeCsv(readFileSync(dataFile("eligibility-questions.csv"), "utf-8"));
  writeFileSync(outputFile("questions.json"), JSON.stringify(data, null, 2) + "\n");
  console.log(
    `Wrote ${String(data.questions.length)} questions and ${String(data.agencies.length)} agencies`,
  );

  const capabilities = normalizeCapabilitiesCsv(
    readFileSync(dataFile("capabilities.csv"), "utf-8"),
    readFileSync(dataFile("question-capability-map.csv"), "utf-8"),
  );
  writeFileSync(outputFile("capabilities.json"), JSON.stringify(capabilities, null, 2) + "\n");
  console.log(
    `Wrote ${String(capabilities.capabilities.length)} capabilities, ` +
      `${String(capabilities.profiles.length)} agency profiles, ` +
      `${String(capabilities.questionLinks.length)} question links`,
  );

  // The question/capability map is checked by hand, so a reference that no longer matches a
  // question is a silent no-op at runtime. Surface it at build time instead — loudly enough to
  // notice, but not fatally: the map is allowed to lag a CSV edit by one commit.
  const { unmatched } = resolveQuestionCapabilityLinks(capabilities.questionLinks, data.questions);
  if (unmatched.length > 0) {
    const list = [...new Set(unmatched.map((link) => link.questionText))];
    console.warn(
      `WARNING: ${String(unmatched.length)} question/capability link(s) match no question in ` +
        `eligibility-questions.csv and will not be shown:\n` +
        list.map((text) => `  - "${text}"`).join("\n"),
    );
  }
}

main();
