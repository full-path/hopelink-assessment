import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDataset,
  SOURCE_FILES,
  SOURCE_ROLES,
  type SourceTexts,
} from "../src/data/dataset";
import { resolveQuestionCapabilityLinks } from "../src/data/normalizeCapabilities";

// Thin CLI wrapper around the shared normalization modules (via src/data/dataset.ts): reads the
// snapshot CSVs in /data and writes the committed JSON the frontend paints first, before (and
// instead of, if it fails) the live Google Sheet.

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataFile = (name: string) => resolve(__dirname, "../data", name);
const outputFile = (name: string) => resolve(__dirname, "../src/data", name);

function main(): void {
  const sources = Object.fromEntries(
    SOURCE_ROLES.map((role) => [role, readFileSync(dataFile(SOURCE_FILES[role]), "utf-8")]),
  ) as Record<keyof SourceTexts, string>;
  const { data, capabilities } = normalizeDataset(sources);

  writeFileSync(outputFile("questions.json"), JSON.stringify(data, null, 2) + "\n");
  console.log(
    `Wrote ${String(data.questions.length)} questions and ${String(data.agencies.length)} agencies`,
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
    const list = [...new Set(unmatched.map((link) => link.questionId))];
    console.warn(
      `WARNING: ${String(unmatched.length)} question/capability link(s) match no question in ` +
        `questions.csv and will not be shown:\n` +
        list.map((text) => `  - "${text}"`).join("\n"),
    );
  }
}

main();
