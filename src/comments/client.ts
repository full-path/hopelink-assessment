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
/**
 * Newest-first search for a comment matching what was just submitted.
 *
 * Newest-first because a retried post can duplicate a comment, and the row just written is the
 * one whose server timestamp should be displayed.
 */
function findPosted(comments: Comment[], draft: NewComment): Comment | undefined {
  for (const candidate of [...comments].reverse()) {
    if (
      candidate.kind === draft.kind &&
      candidate.id === draft.id &&
      candidate.author === draft.author &&
      candidate.body === draft.body
    ) {
      return candidate;
    }
  }
  return undefined;
}

export function createCommentsClient(endpoint: string | undefined): CommentsClient | null {
  const url = endpoint?.trim();
  if (!url) return null;

  // Arrow consts rather than function declarations: TypeScript does not narrow `url` to a
  // definite string inside a hoisted declaration, only inside a closure created after the guard.
  const listComments = async (): Promise<Comment[]> => {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Could not load comments (HTTP ${String(response.status)}).`);
    }
    return parseCommentList(await readJson(response));
  };

  /**
   * Did the post actually land? Asked whenever the POST reply fails to acknowledge it.
   *
   * Apps Script answers a cross-origin POST with a 302, and what comes back from following it
   * is not dependable: it may 404, and it may land on `doGet` and return the comment list
   * instead of `doPost`'s own output. Neither says anything about whether the row was written —
   * observed behaviour is that `doPost` runs and appends either way.
   *
   * So the POST reply is treated as advisory, and this is the authority. GET is reliable — it is
   * how the page loads comments in the first place — so re-reading answers the question directly
   * rather than reporting a failure that did not happen.
   */
  const confirmPosted = async (draft: NewComment): Promise<Comment> => {
    let comments: Comment[];
    try {
      comments = await listComments();
    } catch {
      throw new Error(
        "The comment store did not acknowledge the post and could not be re-read, so it is " +
          "unclear whether the comment was saved. Reload the page to check before re-posting.",
      );
    }

    const found = findPosted(comments, draft);
    if (found) return found;

    throw new Error(
      "The comment was not saved. The passphrase may be incorrect — check it and try again.",
    );
  };

  return {
    list: listComments,

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

      let payload: unknown;
      try {
        payload = await readJson(response);
      } catch {
        // Unreadable reply — see confirmPosted. Ask the store what happened instead of guessing.
        return await confirmPosted(draft);
      }

      if (typeof payload !== "object" || payload === null) {
        return await confirmPosted(draft);
      }

      const { comment, comments, error } = payload as {
        comment?: unknown;
        comments?: unknown;
        error?: unknown;
      };

      // An explicit error is the one thing the reply says that is worth believing outright: only
      // `doPost` produces it, so reaching us means the redirect delivered its output intact.
      // Checked before the HTTP status because every Apps Script reply is 200 — ContentService
      // cannot set a status code, so `error` is the only failure signal there is. (The status is
      // not consulted at all below: it carries no information, and every other outcome is settled
      // by asking the store what it holds.)
      if (typeof error === "string") throw new Error(error);

      // The acknowledgement we hoped for.
      const acknowledged = parseComment(comment);
      if (acknowledged) return acknowledged;

      // Not an acknowledgement but still an answer: when the redirect lands on `doGet` the reply
      // is the whole comment list, and because `doGet` ran after `doPost` appended, the comment
      // is in it. Using it here saves a round trip on what is otherwise a successful post.
      if (Array.isArray(comments)) {
        const parsed = comments
          .map(parseComment)
          .filter((entry): entry is Comment => entry !== null);
        const found = findPosted(parsed, draft);
        if (found) return found;
      }

      // Anything else — an unrecognised shape, or a list without our comment in it — is not
      // evidence either way. Ask the store directly.
      return await confirmPosted(draft);
    },
  };
}
