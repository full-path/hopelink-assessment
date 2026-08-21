/**
 * Comment store for the Find a Ride Unified Intake Explorer.
 *
 * A Google Apps Script web app bound to a Google Sheet. GET returns every visible comment as
 * JSON; POST validates a shared passphrase and appends a row. See README.md in this directory
 * for deployment.
 *
 * This file is checked into the application repository on purpose. It is the only part of the
 * system that does not deploy from CI, so leaving it undocumented would make it invisible
 * infrastructure that a future maintainer has to reverse-engineer from network traffic.
 *
 * It contains NO secret. The passphrase lives in Script Properties (key COMMENT_PASSPHRASE).
 */

var SHEET_NAME = "Comments";

/** Column order in the sheet. Chosen to export cleanly to CSV if comments ever move into /data. */
var HEADERS = ["Timestamp", "Target Kind", "Target Id", "Target Label", "Author", "Body", "Hidden"];

var VALID_KINDS = ["question", "capability"];

/** Mirrors MAX_BODY_LENGTH / MAX_AUTHOR_LENGTH in src/comments/client.ts. */
var MAX_BODY_LENGTH = 2000;
var MAX_AUTHOR_LENGTH = 120;
var MAX_ID_LENGTH = 200;
var MAX_LABEL_LENGTH = 500;

/**
 * Apps Script web apps cannot set an HTTP status code on a ContentService response — every
 * reply is a 200. The client therefore distinguishes failure by the presence of an `error` key,
 * not by status, and checks for it before it checks `response.ok`.
 */
function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function sheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function str_(value, maxLength) {
  if (value === null || value === undefined) return "";
  var text = String(value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/** A row is hidden if the Hidden cell is anything truthy — TRUE, "yes", "x", any non-empty value. */
function isHidden_(cell) {
  if (cell === true) return true;
  var text = String(cell === null || cell === undefined ? "" : cell)
    .trim()
    .toLowerCase();
  return text !== "" && text !== "false" && text !== "no" && text !== "0";
}

function doGet() {
  try {
    var rows = sheet_().getDataRange().getValues();
    var comments = [];

    // Row 0 is the header.
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (isHidden_(row[6])) continue;

      var kind = str_(row[1], 32);
      var id = str_(row[2], MAX_ID_LENGTH);
      var body = str_(row[5], MAX_BODY_LENGTH);
      if (VALID_KINDS.indexOf(kind) === -1 || !id || !body) continue;

      var timestamp = row[0];
      comments.push({
        timestamp: timestamp instanceof Date ? timestamp.toISOString() : str_(timestamp, 64),
        kind: kind,
        id: id,
        targetLabel: str_(row[3], MAX_LABEL_LENGTH),
        author: str_(row[4], MAX_AUTHOR_LENGTH),
        body: body,
      });
    }

    return json_({ comments: comments });
  } catch (error) {
    return json_({ error: "Could not read the comment sheet: " + error.message });
  }
}

function doPost(e) {
  try {
    // The client posts as text/plain to stay a CORS "simple request" — Apps Script web apps do
    // not answer OPTIONS preflight, so an application/json POST never reaches this function.
    // The body is still JSON; it just travels under a content type the browser will not preflight.
    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return json_({ error: "Malformed request body." });
    }

    // Honeypot: a real person never sees this field, so a filled one means an automated
    // submitter. Rejected without saying what gave it away.
    if (str_(payload.website, 100) !== "") {
      return json_({ error: "Comment rejected." });
    }

    var expected = PropertiesService.getScriptProperties().getProperty("COMMENT_PASSPHRASE");
    if (!expected) {
      return json_({
        error: "The comment store is not configured: COMMENT_PASSPHRASE is unset.",
      });
    }
    if (str_(payload.passphrase, 200) !== expected) {
      return json_({ error: "Incorrect passphrase." });
    }

    var kind = str_(payload.kind, 32);
    if (VALID_KINDS.indexOf(kind) === -1) {
      return json_({ error: 'Unknown comment target kind "' + kind + '".' });
    }

    var id = str_(payload.id, MAX_ID_LENGTH);
    var author = str_(payload.author, MAX_AUTHOR_LENGTH);
    var body = str_(payload.body, MAX_BODY_LENGTH);
    if (!id || !author || !body) {
      return json_({ error: "Target, name, and comment body are all required." });
    }

    var comment = {
      timestamp: new Date().toISOString(),
      kind: kind,
      id: id,
      targetLabel: str_(payload.targetLabel, MAX_LABEL_LENGTH),
      author: author,
      body: body,
    };

    // Two readers commenting at once would otherwise race for the same row.
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      sheet_().appendRow([
        comment.timestamp,
        comment.kind,
        comment.id,
        comment.targetLabel,
        comment.author,
        comment.body,
        "",
      ]);
    } finally {
      lock.releaseLock();
    }

    return json_({ comment: comment });
  } catch (error) {
    return json_({ error: "Could not save the comment: " + error.message });
  }
}
