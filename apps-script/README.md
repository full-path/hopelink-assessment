# Comment store (Google Apps Script + Google Sheet)

`Comments.gs` is the backing store for reader comments on intake questions and provider
capabilities. It is the only part of this system that does **not** deploy from CI — you set it up
once by hand, in a Google account that Hopelink controls, and paste the resulting URL into a
GitHub repository variable.

The script is checked in here so that it is reviewable and recoverable. It contains no secret:
the passphrase lives in Script Properties.

## What it does

| Request | Behaviour                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET`   | Returns every non-hidden row as `{ "comments": [...] }`. No passphrase required — the site it serves is public anyway. |
| `POST`  | Validates the shared passphrase, then appends a row. Returns `{ "comment": {...} }` or `{ "error": "..." }`.           |

Every response is HTTP 200 — Apps Script cannot set a status code on a `ContentService`
response — so failure is signalled by the `error` key. `src/comments/client.ts` checks for it
before it checks `response.ok`.

**The POST reply cannot be trusted to carry `doPost`'s output.** Apps Script answers a
cross-origin POST with a 302, and what comes back from following it varies:

- sometimes `doPost`'s own JSON, which is the intended behaviour;
- sometimes HTTP 404, from the single-use `script.googleusercontent.com` URL;
- sometimes `doGet`'s output — the whole comment list — because the redirect was followed as a
  GET against the script.

**In all three cases `doPost` has already run and appended the row.** The write succeeds; only
the acknowledgement is unreliable. `src/comments/client.ts` therefore treats the POST reply as
advisory and settles the question by reading the store: an `error` key is believed outright
(only `doPost` produces one), a comment list is searched for the comment just sent, and anything
else triggers a fresh GET. Found means success; absent means genuine rejection, most likely a
wrong passphrase.

GET goes through the same redirect and is subject to the same blips — a load has been observed
returning 404 from an endpoint that was healthy seconds later. The client retries reads for that
reason, and never retries writes (a retried POST would duplicate a comment).

Do not go looking for a server-side bug when you see this. It is Google's redirect, not this
script, and it is why posting sometimes costs two round trips.

If comments do stop loading persistently, check the deployment itself before suspecting the app:
open the `/exec` URL directly in a browser. JSON means the store is healthy and the problem is
elsewhere; a 404 there means the deployment is gone or the URL is stale — most often because a
_new deployment_ was created instead of a new _version_ of the existing one (see above).

## Setup

1. **Create the spreadsheet.** In Google Drive, create a new Google Sheet named something like
   `Find a Ride — Intake Explorer Comments`. Rename the first tab to **`Comments`**.

2. **Add the header row**, exactly these seven columns in this order:

   | Timestamp | Target Kind | Target Id | Target Label | Author | Body | Hidden |
   | --------- | ----------- | --------- | ------------ | ------ | ---- | ------ |

   (If you skip this, the script creates the tab and header on first use. Doing it by hand just
   means you can see the shape before anything is written.)

3. **Add the script.** In the sheet: **Extensions → Apps Script**. Delete the placeholder
   `myFunction`, paste the entire contents of `Comments.gs`, and save.

4. **Set the passphrase.** In the Apps Script editor: **Project Settings** (gear icon) → **Script
   Properties** → **Add script property**.

   - Property: `COMMENT_PASSPHRASE`
   - Value: the passphrase you will circulate to the pilot group

   Do not put the passphrase in `Comments.gs` — that file is in a public repository.

5. **Deploy as a web app.** **Deploy → New deployment → Web app**:

   - Description: anything
   - **Execute as: Me**
   - **Who has access: Anyone**

   "Anyone" is required — readers are not signed into Google, and "Anyone with a Google account"
   would prompt every one of them to log in. Authorize the scopes when prompted.

6. **Copy the Web app URL.** It ends in `/exec`. This is the endpoint.

7. **Point the site at it.** In the GitHub repository: **Settings → Secrets and variables →
   Actions → Variables → New repository variable**.

   - Name: `COMMENTS_ENDPOINT`
   - Value: the `/exec` URL

   Use a **variable**, not a secret. The URL is compiled into the client bundle in plaintext, so
   storing it as a secret would imply a protection that does not exist. If this variable is
   unset, the site still builds and deploys — commenting is simply absent.

   For local development, put the same URL in a `.env.local` file at the repository root:

   ```
   VITE_COMMENTS_ENDPOINT=https://script.google.com/macros/s/…/exec
   ```

   `.env.local` is already gitignored by the `*.local` rule.

## Re-deploying after an edit

Editing `Comments.gs` in the Apps Script editor does **not** update the live web app. Use
**Deploy → Manage deployments → (pencil icon) → Version: New version → Deploy**. This keeps the
same `/exec` URL. Creating a _new deployment_ instead issues a new URL and you would have to
update `COMMENTS_ENDPOINT`.

## Moderating

Everything happens in the spreadsheet:

- **Hide a comment**: put any value in its `Hidden` cell (`TRUE`, `x`, `spam` — anything other
  than blank, `FALSE`, `no`, or `0`). It stops being served on the next page load; the row stays
  for the record.
- **Delete a comment**: delete the row.
- **Edit**: edit the cell. The app renders whatever the sheet says.
- **Rotate the passphrase**: change the `COMMENT_PASSPHRASE` script property. Readers who stored
  the old one are prompted again on their next failed post.

## Limits and known trade-offs

- **The endpoint is public.** The URL is visible in the site's JavaScript. The passphrase raises
  the cost of drive-by spam, but it is shared and reusable — a gate, not authentication. The
  `Hidden` column is the remedy if something unwanted gets through.
- **Comments are attributable free text typed by agency staff.** They are not rider PII, but
  they are on-the-record statements about an agency's own practice. Confirm the participating
  agencies are comfortable with that before circulating the passphrase.
- **Apps Script quotas** apply (on a consumer account, roughly 20k URL-fetch-free script
  executions a day). Nowhere near a constraint for a review tool used by a committee.
- **No threading, no edit-from-the-app, no notifications.** Deliberately: those need real
  accounts, and this deployment has none.
