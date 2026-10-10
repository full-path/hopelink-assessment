/**
 * Sets up the data spreadsheet for the Find a Ride Unified Intake Explorer.
 *
 * Bound to the DATA spreadsheet — the one staff edit and the site reads — which is a different
 * spreadsheet from the comment store (Comments.gs). Run `setupSheet` once after importing the
 * CSVs from /data, and again whenever this file changes; it is safe to re-run, replacing what it
 * set up before rather than stacking a second copy.
 *
 * It sets up what keeps a centrally edited sheet valid, so errors are caught here, by the person
 * making them, rather than by every reader of the site:
 *
 *  - dropdowns for every fixed-vocabulary column and every reference to another tab, fed by
 *    named ranges, so an ID or agency name is picked rather than typed;
 *  - an ID-shape and uniqueness rule on the ID columns, and a warning before editing an ID;
 *  - highlighting of rows the app would reject;
 *  - a private Checks tab counting every problem the app checks for, and an Instructions tab.
 *
 * The rules mirror the normalizers in src/data/ (normalize.ts, normalizeCapabilities.ts,
 * agencies.ts). The app remains the authority: if they ever disagree, the app's error wins.
 *
 * It does NOT publish anything. Publishing is done by hand (README, "Live data from a Google
 * Sheet"), and must cover the eight data tabs only — never Checks or Instructions.
 */

/** The eight data tabs, their columns in order, and their role name in src/sheetTabs.ts. */
var TABS = [
  {
    role: "agencies",
    name: "Agencies",
    headers: ["Agency", "Kind", "Aliases", "Capability survey", "Note"],
  },
  { role: "agencyGroups", name: "Agency groups", headers: ["Group", "Agency", "Note"] },
  { role: "questions", name: "Questions", headers: ["ID", "Question", "Data Quality Notes"] },
  {
    role: "requirements",
    name: "Requirements",
    headers: ["Question ID", "Agency", "Asked", "Verification", "Proof detail"],
  },
  { role: "questionLinks", name: "Question links", headers: ["Question ID", "Leads to", "Note"] },
  { role: "capabilities", name: "Capabilities", headers: ["ID", "Label"] },
  {
    role: "providerCapabilities",
    name: "Provider capabilities",
    headers: ["Agency", "Capability ID", "Answer", "Agency's wording"],
  },
  {
    role: "capabilityMap",
    name: "Question-capability map",
    headers: ["Question ID", "Capability ID", "Note"],
  },
];

/** Dropdown vocabularies. Mirror the maps of the same purpose in src/data/. */
var KINDS = ["Ride provider", "Fare program", "Travel training"];
var SURVEY = ["Returned"];
var ASKED = ["Required", "Optional", "Unknown"];
var VERIFICATION = ["Self-attestation", "Proof required"];
var ANSWERS = ["Yes", "No", "Conditional"];

/** Mirrors ID_PATTERN in src/data/tabs.ts. */
var ID_REGEX = "^[a-z0-9]+(-[a-z0-9]+)*$";

var PROTECTION_PREFIX = "Intake explorer: ";
var INVALID_FILL = "#f4c7c3";

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  TABS.forEach(function (tab) {
    ensureTab_(ss, tab);
  });

  ss.setNamedRange("QuestionIDs", column_(ss, "Questions", 1));
  ss.setNamedRange("AgencyNames", column_(ss, "Agencies", 1));
  ss.setNamedRange("CapabilityIDs", column_(ss, "Capabilities", 1));

  setUpAgencies_(ss);
  setUpAgencyGroups_(ss);
  setUpQuestions_(ss);
  setUpRequirements_(ss);
  setUpQuestionLinks_(ss);
  setUpCapabilities_(ss);
  setUpProviderCapabilities_(ss);
  setUpCapabilityMap_(ss);
  writeChecks_(ss);
  writeInstructions_(ss);

  Logger.log(sheetTabsSnippet_(ss));
}

// --- Per-tab setup -------------------------------------------------------------------------

function setUpAgencies_(ss) {
  list_(ss, "Agencies", 2, KINDS);
  list_(ss, "Agencies", 4, SURVEY);
}

function setUpAgencyGroups_(ss) {
  fromRange_(ss, "Agency groups", 2, "AgencyNames");
  // The same agency listed twice in one group.
  highlight_(ss, "Agency groups", ['=AND($A2<>"", COUNTIFS($A:$A, $A2, $B:$B, $B2) > 1)']);
}

function setUpQuestions_(ss) {
  idColumn_(ss, "Questions");
}

function setUpRequirements_(ss) {
  fromRange_(ss, "Requirements", 1, "QuestionIDs");
  fromRange_(ss, "Requirements", 2, "AgencyNames");
  list_(ss, "Requirements", 3, ASKED);
  list_(ss, "Requirements", 4, VERIFICATION);
  highlight_(ss, "Requirements", [
    // A second row for the same question and agency — the contradiction this layout prevents.
    '=AND($A2<>"", COUNTIFS($A:$A, $A2, $B:$B, $B2) > 1)',
    // No Asked: it is always stated, as Unknown if the agency has not said.
    '=AND($A2<>"", $C2="")',
    // Unknown with no Verification records nothing.
    '=AND($A2<>"", $C2="Unknown", $D2="")',
    // Proof detail on a row that does not require proof.
    '=AND($E2<>"", $D2<>"Proof required")',
  ]);
}

function setUpQuestionLinks_(ss) {
  fromRange_(ss, "Question links", 1, "QuestionIDs");
  fromRange_(ss, "Question links", 2, "QuestionIDs");
  highlight_(ss, "Question links", ['=AND($A2<>"", $A2=$B2)']);
}

function setUpCapabilities_(ss) {
  idColumn_(ss, "Capabilities");
}

function setUpProviderCapabilities_(ss) {
  fromRange_(ss, "Provider capabilities", 1, "AgencyNames");
  fromRange_(ss, "Provider capabilities", 2, "CapabilityIDs");
  list_(ss, "Provider capabilities", 3, ANSWERS);
  highlight_(ss, "Provider capabilities", [
    '=AND($A2<>"", COUNTIFS($A:$A, $A2, $B:$B, $B2) > 1)',
    // An answer from an agency the Agencies tab does not mark as having returned the survey.
    '=AND($A2<>"", COUNTIFS(Agencies!$A:$A, $A2, Agencies!$D:$D, "Returned") = 0)',
  ]);
}

function setUpCapabilityMap_(ss) {
  fromRange_(ss, "Question-capability map", 1, "QuestionIDs");
  fromRange_(ss, "Question-capability map", 2, "CapabilityIDs");
}

// --- Checks and Instructions ---------------------------------------------------------------

/**
 * One row per problem the app rejects (or, for links, flags). Each count should be 0 before a
 * round of edits is considered finished; the app shows the snapshot and an error otherwise.
 */
var CHECKS = [
  [
    "Agency groups: agency not in the Agencies tab",
    "=SUMPRODUCT(('Agency groups'!B2:B<>\"\")*(COUNTIF(Agencies!A2:A,'Agency groups'!B2:B)=0))",
  ],
  [
    "Agency groups: an agency listed twice in one group",
    "=SUMPRODUCT(('Agency groups'!A2:A<>\"\")*(COUNTIFS('Agency groups'!A2:A,'Agency groups'!A2:A,'Agency groups'!B2:B,'Agency groups'!B2:B)>1))",
  ],
  [
    "Questions: duplicate IDs",
    '=SUMPRODUCT((Questions!A2:A<>"")*(COUNTIF(Questions!A2:A,Questions!A2:A)>1))',
  ],
  [
    "Questions: IDs not in lowercase-hyphen form",
    '=SUMPRODUCT((Questions!A2:A<>"")*NOT(REGEXMATCH(Questions!A2:A&"","' + ID_REGEX + '")))',
  ],
  [
    "Requirements: unknown Question ID",
    '=SUMPRODUCT((Requirements!A2:A<>"")*(COUNTIF(Questions!A2:A,Requirements!A2:A)=0))',
  ],
  [
    "Requirements: agency not in the Agencies tab",
    '=SUMPRODUCT((Requirements!B2:B<>"")*(COUNTIF(Agencies!A2:A,Requirements!B2:B)=0))',
  ],
  [
    "Requirements: more than one row for a question and agency",
    '=SUMPRODUCT((Requirements!A2:A<>"")*(COUNTIFS(Requirements!A2:A,Requirements!A2:A,Requirements!B2:B,Requirements!B2:B)>1))',
  ],
  [
    "Requirements: rows with no Asked (use Unknown if the agency has not said)",
    '=COUNTIFS(Requirements!A2:A,"<>",Requirements!C2:C,"")',
  ],
  [
    "Requirements: Asked Unknown with no Verification",
    '=COUNTIFS(Requirements!A2:A,"<>",Requirements!C2:C,"Unknown",Requirements!D2:D,"")',
  ],
  [
    "Requirements: Proof detail without Proof required",
    '=COUNTIFS(Requirements!E2:E,"<>",Requirements!D2:D,"<>Proof required")',
  ],
  [
    "Question links: an end that is not a question (shown in the app as unresolved)",
    "=SUMPRODUCT(('Question links'!A2:A<>\"\")*(((COUNTIF(Questions!A2:A,'Question links'!A2:A)=0)+(COUNTIF(Questions!A2:A,'Question links'!B2:B)=0))>0))",
  ],
  [
    "Capabilities: duplicate IDs",
    '=SUMPRODUCT((Capabilities!A2:A<>"")*(COUNTIF(Capabilities!A2:A,Capabilities!A2:A)>1))',
  ],
  [
    "Provider capabilities: answers from agencies not marked Returned",
    "=SUMPRODUCT(('Provider capabilities'!A2:A<>\"\")*(COUNTIFS(Agencies!A2:A,'Provider capabilities'!A2:A,Agencies!D2:D,\"Returned\")=0))",
  ],
  [
    "Provider capabilities: unknown Capability ID",
    "=SUMPRODUCT(('Provider capabilities'!B2:B<>\"\")*(COUNTIF(Capabilities!A2:A,'Provider capabilities'!B2:B)=0))",
  ],
  [
    "Question-capability map: unknown Question ID (reported by the app, not fatal)",
    "=SUMPRODUCT(('Question-capability map'!A2:A<>\"\")*(COUNTIF(Questions!A2:A,'Question-capability map'!A2:A)=0))",
  ],
  [
    "Question-capability map: unknown Capability ID",
    "=SUMPRODUCT(('Question-capability map'!B2:B<>\"\")*(COUNTIF(Capabilities!A2:A,'Question-capability map'!B2:B)=0))",
  ],
];

function writeChecks_(ss) {
  var sheet = ss.getSheetByName("Checks") || ss.insertSheet("Checks");
  sheet.clear();
  sheet
    .getRange(1, 1, 1, 2)
    .setValues([["Check", "Problems"]])
    .setFontWeight("bold");
  CHECKS.forEach(function (check, i) {
    sheet.getRange(i + 2, 1).setValue(check[0]);
    sheet.getRange(i + 2, 2).setFormula(check[1]);
  });
  var counts = sheet.getRange(2, 2, CHECKS.length, 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setBackground(INVALID_FILL)
      .setRanges([counts])
      .build(),
  ]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumn(1);
}

var INSTRUCTIONS = [
  "How to edit this sheet",
  "",
  "This tab and the Checks tab are private. The eight data tabs are published to the web and read by the Intake Explorer on every page load; an edit shows up there within about five minutes.",
  "Before finishing a round of edits, open the Checks tab: every count should be 0. If the site cannot use the sheet, it keeps showing its built-in copy and says why.",
  "",
  "Add a question: add a row to Questions with a new ID (lowercase words joined by hyphens, e.g. do-you-use-a-scooter) and the question text. Then add one row to Requirements for each agency that asks it.",
  "Reword a question: change the Question text only. Never change an ID once it exists — comments on the site are attached to it.",
  "Record how an agency asks a question: one Requirements row per question and agency. Asked = Required, Optional, or Unknown if the agency has not said (never blank; Unknown needs a Verification). Verification = Self-attestation or Proof required. Proof detail only when Verification is Proof required.",
  "Link questions: one row in Question links, from the question that comes first to the one it leads to. The site shows the link from both ends.",
  "Add an agency: add a row to Agencies first, then pick it from the dropdowns elsewhere. Kind decides whether vehicle capabilities apply to it. Aliases are other spellings, separated by semicolons.",
  "Record a provider capability: mark the agency's Capability survey as Returned on the Agencies tab, then add a Provider capabilities row per answer. A missing row means unknown, never no. Put the agency's own wording (e.g. Depends on vehicle) in Agency's wording.",
  "Group agencies: one row in Agency groups per agency in a group (e.g. Paratransit providers / Access Paratransit). Spell the group name the same on every row. Readers can then show or hide the whole group at once; an agency can be in any number of groups.",
  "Add a capability: add a row to Capabilities with a new ID and a label. Labels can be reworded freely; IDs cannot.",
  "",
  "Red cells mark rows the site will reject. Re-run setupSheet (Extensions → Apps Script) if the dropdowns or highlighting go missing.",
];

function writeInstructions_(ss) {
  var sheet = ss.getSheetByName("Instructions") || ss.insertSheet("Instructions", 0);
  sheet.clear();
  sheet
    .getRange(1, 1, INSTRUCTIONS.length, 1)
    .setValues(
      INSTRUCTIONS.map(function (line) {
        return [line];
      }),
    )
    .setWrap(true);
  sheet.getRange(1, 1).setFontWeight("bold").setFontSize(14);
  sheet.setColumnWidth(1, 900);
}

// --- Helpers -------------------------------------------------------------------------------

/** Creates the tab with its header row if missing; checks the header if present. */
function ensureTab_(ss, tab) {
  var sheet = ss.getSheetByName(tab.name);
  if (!sheet) {
    sheet = ss.insertSheet(tab.name);
    sheet.getRange(1, 1, 1, tab.headers.length).setValues([tab.headers]);
  }
  var found = sheet.getRange(1, 1, 1, tab.headers.length).getValues()[0];
  tab.headers.forEach(function (header, i) {
    if (String(found[i]).trim() !== header) {
      throw new Error(
        'Tab "' +
          tab.name +
          '" column ' +
          (i + 1) +
          ' should be "' +
          header +
          '", found "' +
          found[i] +
          '".',
      );
    }
  });
  sheet.getRange(1, 1, 1, tab.headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

/** Rows 2 to the bottom of one column. */
function column_(ss, tabName, column) {
  var sheet = ss.getSheetByName(tabName);
  return sheet.getRange(2, column, sheet.getMaxRows() - 1, 1);
}

function list_(ss, tabName, column, values) {
  column_(ss, tabName, column).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(values, true)
      .setAllowInvalid(false)
      .build(),
  );
}

function fromRange_(ss, tabName, column, namedRange) {
  column_(ss, tabName, column).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getRangeByName(namedRange), true)
      .setAllowInvalid(false)
      .build(),
  );
}

/** ID shape and uniqueness on column A, plus a warning before anyone edits an existing ID. */
function idColumn_(ss, tabName) {
  var ids = column_(ss, tabName, 1);
  ids.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(
        '=AND(REGEXMATCH(A2&"", "' + ID_REGEX + '"), COUNTIF($A:$A, A2) = 1)',
      )
      .setAllowInvalid(false)
      .setHelpText(
        "Lowercase words joined by hyphens, unique in this tab. Never change an existing ID.",
      )
      .build(),
  );

  var sheet = ss.getSheetByName(tabName);
  var description = PROTECTION_PREFIX + tabName + " IDs";
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === description) p.remove();
  });
  ids.protect().setDescription(description).setWarningOnly(true);
}

/** Replaces the tab's conditional formatting with whole-row highlights for these formulas. */
function highlight_(ss, tabName, formulas) {
  var sheet = ss.getSheetByName(tabName);
  var rows = sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getLastColumn());
  sheet.setConditionalFormatRules(
    formulas.map(function (formula) {
      return SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(formula)
        .setBackground(INVALID_FILL)
        .setRanges([rows])
        .build();
    }),
  );
}

/** The src/sheetTabs.ts block, filled in with this spreadsheet's gids. */
function sheetTabsSnippet_(ss) {
  var lines = TABS.map(function (tab) {
    return (
      "  " +
      tab.role +
      ': { name: "' +
      tab.name +
      '", gid: ' +
      ss.getSheetByName(tab.name).getSheetId() +
      " },"
    );
  });
  return (
    "Paste into src/sheetTabs.ts:\n\n" +
    "export const SHEET_TABS: Record<keyof SourceTexts, { name: string; gid: number | null }> = {\n" +
    lines.join("\n") +
    "\n};"
  );
}
