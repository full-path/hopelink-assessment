/**
 * The data contract for reader comments.
 *
 * Comments are the one thing this tool persists (see CLAUDE.md §7 and §10). They live in a
 * Google Sheet behind an Apps Script web app rather than in the repo, because the audience that
 * moderates them — Hopelink program staff — already works in spreadsheets, and because a sheet
 * exports straight back to the CSV shape the rest of the pipeline reads.
 */

/** What a comment is attached to. Questions and capabilities are the two things a reader sees. */
export type CommentTargetKind = "question" | "capability";

export interface CommentTarget {
  kind: CommentTargetKind;
  /** Slug id: an IntakeQuestion.id or a Capability.id. */
  id: string;
}

export interface Comment extends CommentTarget {
  /** ISO 8601, assigned server-side so a client clock cannot reorder the thread. */
  timestamp: string;
  author: string;
  body: string;
  /**
   * The question text or capability label as it read when the comment was written.
   *
   * Redundant with `id` while the dataset is unchanged, and that is the point: question ids are
   * slugs of question text, so rewording a question breaks the id. Keeping the label means an
   * orphaned comment can still be shown with the thing it was about, rather than as a bare slug.
   */
  targetLabel: string;
}

/** A comment as submitted, before the server stamps it. */
export type NewComment = Omit<Comment, "timestamp">;

/**
 * Where the comment fetch has got to. Rendered directly, so the UI can distinguish "still
 * loading" from "loaded, no comments yet" from "the endpoint is broken" — three states that a
 * bare empty list would flatten into one.
 *
 * "disabled" is the no-endpoint-configured build (see `createCommentsClient`), which is a normal
 * state for local development and for the test suite, not an error.
 */
export type CommentState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "ready"; comments: Comment[] }
  | { status: "error"; message: string };
