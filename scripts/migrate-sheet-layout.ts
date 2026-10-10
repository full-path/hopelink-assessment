import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { normalizeDataset } from "../src/data/dataset";
import { resolveQuestionCapabilityLinks } from "../src/data/normalizeCapabilities";

// ONE-OFF. Converts the hand-cleaned CSVs into the one-value-per-cell layout used by the Google
// Sheet. It reads the old files through the old normalizer, so every cleanup decision already
// made there carries over, and writes the new files from the normalized result. Committed once
// so the conversion is reviewable, then deleted.

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataFile = (name: string) => resolve(__dirname, "../data", name);
const read = (name: string) => readFileSync(dataFile(name), "utf-8");
const write = (name: string, rows: Record<string, string>[], fields: string[]) => {
  writeFileSync(
    dataFile(name),
    Papa.unparse({ fields, data: rows.map((r) => fields.map((f) => r[f] ?? "")) }) + "\n",
  );
};

const { data, capabilities } = normalizeDataset({
  agencies: read("agencies.csv"),
  questions: read("eligibility-questions.csv"),
  capabilities: read("capabilities.csv"),
  capabilityMap: read("question-capability-map.csv"),
});
const agencyName = new Map(data.agencies.map((a) => [a.id, a.displayName]));

// --- Agencies: add Capability survey -------------------------------------------------------
const surveyed = new Set(capabilities.profiles.map((p) => p.agencyId));
const rosterRows = Papa.parse<Record<string, string>>(read("agencies.csv"), {
  header: true,
  skipEmptyLines: true,
}).data;
write(
  "agencies.csv",
  rosterRows.map((row) => {
    const id = data.agencies.find((a) => a.displayName === row.Agency)?.id ?? "";
    return { ...row, "Capability survey": surveyed.has(id) ? "Returned" : "" };
  }),
  ["Agency", "Kind", "Aliases", "Capability survey", "Note"],
);

// --- Questions, Requirements ---------------------------------------------------------------
const CONTRADICTION_NOTE =
  " In the one-row-per-agency layout ORCA's row records Required, the stricter of the two, " +
  "pending that confirmation.";

const questionRows: Record<string, string>[] = [];
const requirementRows: Record<string, string>[] = [];
for (const question of data.questions) {
  let note = question.dataQualityNote ?? "";

  const agencyOrder: string[] = [];
  for (const req of question.requirements) {
    if (!agencyOrder.includes(req.agencyId)) agencyOrder.push(req.agencyId);
  }
  for (const agencyId of agencyOrder) {
    const reqs = question.requirements.filter((r) => r.agencyId === agencyId);
    const levels = reqs.map((r) => r.level);
    const asked = levels.includes("required")
      ? "Required"
      : levels.includes("optional")
        ? "Optional"
        : "";
    if (levels.includes("required") && levels.includes("optional")) {
      if (agencyId !== "orca" || question.id !== "phone") {
        throw new Error(`Unexpected Required+Optional for ${agencyId} on ${question.id}`);
      }
      note += CONTRADICTION_NOTE;
    }
    const verifications = reqs.filter(
      (r) => r.level === "self_attestation" || r.level === "proof_required",
    );
    if (verifications.length > 1)
      throw new Error(`Two verifications for ${agencyId} on ${question.id}`);
    const verification = verifications[0];
    requirementRows.push({
      "Question ID": question.id,
      Agency: agencyName.get(agencyId) ?? agencyId,
      Asked: asked,
      Verification:
        verification?.level === "self_attestation"
          ? "Self-attestation"
          : verification?.level === "proof_required"
            ? "Proof required"
            : "",
      "Proof detail": verification?.proofDetail ?? "",
    });
  }

  questionRows.push({ ID: question.id, Question: question.text, "Data Quality Notes": note });
}
write("questions.csv", questionRows, ["ID", "Question", "Data Quality Notes"]);
write("requirements.csv", requirementRows, [
  "Question ID",
  "Agency",
  "Asked",
  "Verification",
  "Proof detail",
]);

// --- Question links: one row per edge, in the "gates" direction ----------------------------
const edges: [string, string][] = [];
const addEdge = (from: string, to: string) => {
  if (!edges.some(([f, t]) => f === from && t === to)) edges.push([from, to]);
};
for (const question of data.questions) {
  if (question.unresolvedLinks?.length) throw new Error(`Unresolved links on ${question.id}`);
  for (const up of question.upstreamRefs) addEdge(up, question.id);
  for (const down of question.downstreamRefs) addEdge(question.id, down);
}
write(
  "question-links.csv",
  edges.map(([from, to]) => ({ "Question ID": from, "Leads to": to })),
  ["Question ID", "Leads to", "Note"],
);

// --- Capabilities: definitions, long-form answers, map by id -------------------------------
write(
  "capabilities.csv",
  capabilities.capabilities.map((c) => ({ ID: c.id, Label: c.label })),
  ["ID", "Label"],
);

const ANSWER = { yes: "Yes", no: "No", conditional: "Conditional" } as const;
const answerRows: Record<string, string>[] = [];
for (const profile of capabilities.profiles) {
  for (const entry of profile.capabilities) {
    if (entry.value === "unknown") continue;
    answerRows.push({
      Agency: agencyName.get(profile.agencyId) ?? profile.agencyId,
      "Capability ID": entry.capabilityId,
      Answer: ANSWER[entry.value],
      "Agency's wording": entry.qualifier ?? "",
    });
  }
}
write("provider-capabilities.csv", answerRows, [
  "Agency",
  "Capability ID",
  "Answer",
  "Agency's wording",
]);

const { byQuestionId, unmatched } = resolveQuestionCapabilityLinks(
  capabilities.questionLinks,
  data.questions,
);
if (unmatched.length > 0) throw new Error("Unmatched map links");
const mapRows: Record<string, string>[] = [];
for (const link of capabilities.questionLinks) {
  const questionId = [...byQuestionId].find(([, links]) => links.includes(link))?.[0] ?? "";
  mapRows.push({
    "Question ID": questionId,
    "Capability ID": link.capabilityId,
    Note: link.note ?? "",
  });
}
write("question-capability-map.csv", mapRows, ["Question ID", "Capability ID", "Note"]);

console.log(
  `Wrote ${String(questionRows.length)} questions, ${String(requirementRows.length)} requirement rows, ` +
    `${String(edges.length)} links, ${String(answerRows.length)} capability answers, ${String(mapRows.length)} map rows.`,
);
