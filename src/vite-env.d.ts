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
   * Set to the string `"true"` to show the "Preview a replacement CSV" control, which is hidden
   * by default. Anything else, including unset, leaves it hidden; the upload machinery behind it
   * stays built either way.
   */
  readonly VITE_SHOW_CSV_UPLOAD?: string;
  /**
   * Published-to-web CSV URLs of the live Google Sheet's four tabs (README, "Live data from a
   * Google Sheet"). Public by construction — publishing a tab makes it readable by anyone with
   * the URL. Set all four or none: with none, the app shows the bundled snapshot only; with some,
   * it reports the gap and shows the snapshot. See `readSheetConfig` in `src/sheetSource.ts`.
   */
  readonly VITE_SHEET_AGENCIES_CSV_URL?: string;
  readonly VITE_SHEET_QUESTIONS_CSV_URL?: string;
  readonly VITE_SHEET_CAPABILITIES_CSV_URL?: string;
  readonly VITE_SHEET_CAPABILITY_MAP_CSV_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
