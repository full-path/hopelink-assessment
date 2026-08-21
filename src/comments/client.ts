import type { Comment, CommentTargetKind, NewComment } from "./types";

/**
 * Transport for the comment store: a Google Apps Script web app bound to a Google Sheet.
 * The script itself is checked into `apps-script/Comments.gs` so this is not invisible
 * infrastructure — see `apps-script/README.md` for how it is deployed.
 *
 * Everything that knows about the network lives here. `resolve.ts` stays pure.
 */

const VALID_KINDS: readonly CommentTargetKind[] = ["question", "capability"];

/** Matches the server-side cap in Comments.gs; checked here too so a typo fails fast and local. */
export const MAX_BODY_LENGTH = 2000;
export const MAX_AUTHOR_LENGTH = 120;

export interface PostOptions {
  passphrase: string;
  /**
   * Value of the form's hidden honeypot field. A human never sees it, so anything other than an
   * empty string means an automated submitter filled the form in blindly, and the server drops
   * the request. Weak on its own — the passphrase is the actual gate — but free.
   */
  honeypot: string;
}

export interface CommentsClient {
  list(): Promise<Comment[]>;
  post(draft: NewComment, options: PostOptions): Promise<Comment>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Validates one record from the remote store.
 *
 * The sheet is hand-editable by Hopelink staff, so a row can legitimately be half-filled or have
 * a mistyped kind. A bad row is skipped rather than throwing, because one malformed row must not
 * cost the reader every other comment on the page.
 */
function parseComment(raw: unknown): Comment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const kind = asString(record.kind);
  const id = asString(record.id);
  const body = asString(record.body);
  if (!VALID_KINDS.includes(kind as CommentTargetKind) || !id || !body) return null;

  return {
    kind: kind as CommentTargetKind,
    id,
    body,
    timestamp: asString(record.timestamp),
    author: asString(record.author) || "Anonymous",
    targetLabel: asString(record.targetLabel),
  };
}

function parseCommentList(payload: unknown): Comment[] {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Comment store returned an unexpected response.");
  }
  const { comments, error } = payload as { comments?: unknown; error?: unknown };
  if (typeof error === "string") throw new Error(error);
  if (!Array.isArray(comments)) {
    throw new Error("Comment store returned an unexpected response.");
  }
  return comments.map(parseComment).filter((comment): comment is Comment => comment !== null);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // An Apps Script that throws serves an HTML error page, not JSON. Say so in terms a reader
    // can act on rather than surfacing a raw JSON.parse message.
    throw new Error(
      `Comment store returned a non-JSON response (HTTP ${String(response.status)}). ` +
        "The Apps Script deployment may be misconfigured.",
    );
  }
}

/**
 * Returns null when no endpoint is configured, which disables commenting rather than erroring.
 *
 * That is a normal state, not a failure: local development works without a deployed script, the
 * test suite stays hermetic, and a build with no `VITE_COMMENTS_ENDPOINT` still renders the whole
 * analysis. Comments are an enhancement; the analysis is the product.
 */
export function createCommentsClient(endpoint: string | undefined): CommentsClient | null {
  const url = endpoint?.trim();
  if (!url) return null;

  return {
    async list(): Promise<Comment[]> {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Could not load comments (HTTP ${String(response.status)}).`);
      }
      return parseCommentList(await readJson(response));
    },

    async post(draft: NewComment, options: PostOptions): Promise<Comment> {
      if (draft.body.length > MAX_BODY_LENGTH) {
        throw new Error(`Comment is too long (limit ${String(MAX_BODY_LENGTH)} characters).`);
      }

      // Deliberately a CORS "simple request": text/plain content type, no custom headers.
      // Apps Script web apps do not answer OPTIONS preflight, so an application/json POST is
      // rejected by the browser before it is ever sent — and the failure looks like a generic
      // network error rather than anything that points here. Do not "fix" this content type.
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          ...draft,
          passphrase: options.passphrase,
          website: options.honeypot,
        }),
      });

      const payload = await readJson(response);
      if (typeof payload !== "object" || payload === null) {
        throw new Error("Comment store returned an unexpected response.");
      }
      const { comment, error } = payload as { comment?: unknown; error?: unknown };
      if (typeof error === "string") throw new Error(error);
      if (!response.ok) {
        throw new Error(`Could not post comment (HTTP ${String(response.status)}).`);
      }

      const parsed = parseComment(comment);
      if (!parsed) throw new Error("Comment store accepted the comment but returned no record.");
      return parsed;
    },
  };
}
