/// <reference types="vite/client" />

/**
 * Build-time configuration read by `src/main.ts`.
 *
 * `VITE_*` values are inlined into the client bundle in plaintext, so this may only ever hold
 * things that are safe to publish. The comment endpoint qualifies — it is a public URL by design.
 * The comment passphrase does NOT, and is deliberately absent here: it is typed by the reader and
 * kept in localStorage. Baking it in would make the gate decorative.
 */
interface ImportMetaEnv {
  /**
   * URL of the deployed Apps Script comment store (`apps-script/README.md`). When unset,
   * commenting is disabled and the rest of the app renders normally.
   */
  readonly VITE_COMMENTS_ENDPOINT?: string;
  /**
   * Set to the string `"true"` to show the "Preview replacement CSVs" control, which is hidden
   * by default. Anything else, including unset, leaves it hidden; the upload machinery behind it
   * stays built either way.
   */
  readonly VITE_SHOW_CSV_UPLOAD?: string;
  /**
   * The live Google Sheet's "Publish to web" link, ending in `/pub` (README, "Live data from a
   * Google Sheet"). Public by construction — publishing makes the chosen tabs readable by anyone
   * with the URL. The tabs themselves are identified in `src/sheetTabs.ts`. Unset, the app shows
   * the bundled snapshot only. See `readSheetConfig` in `src/sheetSource.ts`.
   */
  readonly VITE_SHEET_PUBLISHED_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
