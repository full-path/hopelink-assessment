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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
