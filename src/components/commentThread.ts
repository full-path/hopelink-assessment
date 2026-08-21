import { h, clear } from "../dom";
import { MAX_AUTHOR_LENGTH, MAX_BODY_LENGTH, type CommentsClient } from "../comments/client";
import type { Comment, CommentState, CommentTarget, CommentTargetKind } from "../comments/types";
import { commentsFor, type ResolvedComments } from "../comments/resolve";

/**
 * A comment thread plus its post form, for one question or one capability.
 *
 * SECURITY — comment bodies are the only user-generated content this application renders, and
 * they are stored, so a mistake here is stored XSS rather than a cosmetic bug. Every value below
 * reaches the DOM through `h()` and `Node.append()`, which create text nodes: markup in a comment
 * body renders as literal characters. Do not introduce `innerHTML`, `insertAdjacentHTML`, or any
 * templating that produces raw HTML in this file. `src/comments/client.test.ts` and the render
 * test cover the escaping behaviour, but the real guarantee is that no raw-HTML sink exists here.
 */

/** Where the shared passphrase is remembered so readers don't retype it on every comment. */
const PASSPHRASE_STORAGE_KEY = "hopelink-comment-passphrase";

export interface CommentThreadProps {
  target: CommentTarget;
  /** Question text or capability label, stored with the comment so orphans stay readable. */
  targetLabel: string;
  /** Fetch status for the whole comment set — the thread reflects it rather than guessing. */
  state: CommentState;
  comments: Comment[];
  /** Null when no endpoint is configured, which renders the thread read-only. */
  client: CommentsClient | null;
  /**
   * Called after a successful post so the caller can fold the new comment into application
   * state. Deliberately does not trigger a full re-render: this thread lives inside an expanded
   * <details>, and re-rendering the page would collapse it out from under the reader.
   */
  onPosted: (comment: Comment) => void;
}

/** localStorage throws in some privacy modes and in sandboxed frames; never let that break the page. */
function readStoredPassphrase(): string {
  try {
    return localStorage.getItem(PASSPHRASE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storePassphrase(value: string): void {
  try {
    localStorage.setItem(PASSPHRASE_STORAGE_KEY, value);
  } catch {
    // Not being able to remember the passphrase is a minor inconvenience, not a failure.
  }
}

function forgetPassphrase(): void {
  try {
    localStorage.removeItem(PASSPHRASE_STORAGE_KEY);
  } catch {
    // As above.
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function renderComment(comment: Comment): HTMLElement {
  return h(
    "li",
    { className: "comment" },
    h(
      "p",
      { className: "comment__meta" },
      h("strong", { className: "comment__author" }, comment.author),
      comment.timestamp
        ? h(
            "time",
            { className: "comment__time", datetime: comment.timestamp },
            formatTimestamp(comment.timestamp),
          )
        : undefined,
    ),
    h("p", { className: "comment__body" }, comment.body),
  );
}

/** Domain id fragment, safe for use in an HTML id and a CSS selector. */
function domKey(target: CommentTarget): string {
  return `${target.kind}-${target.id}`;
}

function renderStatusLine(state: CommentState, count: number): HTMLElement | undefined {
  switch (state.status) {
    case "loading":
      return h("p", { className: "empty-note", role: "status" }, "Loading comments…");
    case "error":
      return h(
        "p",
        { className: "comments__error", role: "status" },
        `Comments are unavailable: ${state.message}`,
      );
    case "disabled":
      return h(
        "p",
        { className: "empty-note" },
        "Commenting is not configured for this deployment.",
      );
    case "ready":
      return count === 0 ? h("p", { className: "empty-note" }, "No comments yet.") : undefined;
  }
}

function renderForm(
  props: CommentThreadProps,
  client: CommentsClient,
  list: HTMLElement,
): HTMLElement {
  const key = domKey(props.target);

  const authorInput = h("input", {
    type: "text",
    id: `comment-author-${key}`,
    name: "author",
    maxlength: String(MAX_AUTHOR_LENGTH),
    autocomplete: "name",
    required: true,
  });

  const bodyInput = h("textarea", {
    id: `comment-body-${key}`,
    name: "body",
    rows: "3",
    maxlength: String(MAX_BODY_LENGTH),
    required: true,
  });

  const passphraseInput = h("input", {
    type: "password",
    id: `comment-passphrase-${key}`,
    name: "passphrase",
    autocomplete: "off",
    required: true,
    value: readStoredPassphrase(),
  });

  // Honeypot: invisible to a human, so a non-empty value means an automated submitter filled the
  // form in blindly. The server drops those. Weak on its own — the passphrase is the real gate.
  const honeypotInput = h("input", {
    type: "text",
    className: "comment-form__honeypot",
    name: "website",
    tabindex: "-1",
    autocomplete: "off",
    "aria-hidden": "true",
  });

  const status = h("p", { className: "comment-form__status", role: "status" });
  const submit = h("button", { type: "submit", className: "comment-form__submit" }, "Post comment");

  function setStatus(message: string, isError: boolean): void {
    clear(status);
    status.setAttribute(
      "class",
      isError ? "comment-form__status is-error" : "comment-form__status",
    );
    if (message) status.append(message);
  }

  async function submitComment(): Promise<void> {
    const author = authorInput.value.trim();
    const body = bodyInput.value.trim();
    const passphrase = passphraseInput.value.trim();

    if (!author || !body || !passphrase) {
      setStatus("Name, comment, and passphrase are all required.", true);
      return;
    }

    submit.disabled = true;
    setStatus("Posting…", false);

    try {
      const posted = await client.post(
        { ...props.target, author, body, targetLabel: props.targetLabel },
        { passphrase, honeypot: honeypotInput.value },
      );

      storePassphrase(passphrase);

      // Append in place rather than asking for a re-render, so the open <details> stays open.
      const emptyNote = list.parentElement?.querySelector(".empty-note");
      emptyNote?.remove();
      list.append(renderComment(posted));
      props.onPosted(posted);

      bodyInput.value = "";
      setStatus("Comment posted.", false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A rejected passphrase is almost always a stale stored one; drop it so the next attempt
      // starts from a blank field instead of silently resubmitting the same wrong value.
      if (/passphrase/i.test(message)) forgetPassphrase();
      setStatus(message, true);
    } finally {
      submit.disabled = false;
    }
  }

  return h(
    "form",
    {
      className: "comment-form",
      onSubmit: (event: Event) => {
        event.preventDefault();
        void submitComment();
      },
    },
    h("label", { for: `comment-author-${key}` }, "Your name"),
    authorInput,
    h("label", { for: `comment-body-${key}` }, "Comment"),
    bodyInput,
    h("label", { for: `comment-passphrase-${key}` }, "Group passphrase"),
    passphraseInput,
    honeypotInput,
    h(
      "div",
      { className: "comment-form__actions" },
      submit,
      h(
        "button",
        {
          type: "button",
          className: "comment-form__forget",
          onClick: () => {
            forgetPassphrase();
            passphraseInput.value = "";
            setStatus("Saved passphrase cleared from this browser.", false);
          },
        },
        "Forget passphrase",
      ),
    ),
    status,
  );
}

export function renderCommentThread(props: CommentThreadProps): HTMLElement {
  const key = domKey(props.target);
  const headingId = `comments-${key}-heading`;
  const count = props.comments.length;

  const list = h("ul", { className: "comment-list" }, ...props.comments.map(renderComment));

  return h(
    "section",
    { className: "comments", "aria-labelledby": headingId },
    h("h4", { id: headingId }, count > 0 ? `Comments (${String(count)})` : "Comments"),
    renderStatusLine(props.state, count),
    list,
    props.client ? renderForm(props, props.client, list) : undefined,
  );
}

/**
 * Everything a view needs to render any thread, assembled once per render in `main.ts` — the
 * same shape and for the same reason as `CapabilityContext` in `capabilityPanel.ts`.
 */
export interface CommentContext {
  state: CommentState;
  resolved: ResolvedComments;
  /** Null disables posting; threads still render whatever comments loaded. */
  client: CommentsClient | null;
  onPosted: (comment: Comment) => void;
}

/** Convenience wrapper so a view only supplies what is specific to the target. */
export function renderCommentThreadFor(
  context: CommentContext,
  target: CommentTarget,
  targetLabel: string,
): HTMLElement {
  return renderCommentThread({
    target,
    targetLabel,
    state: context.state,
    comments: commentsFor(context.resolved, target),
    client: context.client,
    onPosted: context.onPosted,
  });
}

/** How many comments a target has, for the badge on a collapsed card. */
export function commentCountFor(context: CommentContext, target: CommentTarget): number {
  return commentsFor(context.resolved, target).length;
}

const ORPHAN_KIND_LABELS: Record<CommentTargetKind, string> = {
  question: "question",
  capability: "capability",
};

/**
 * Comments whose target no longer exists in the dataset on screen — because a question was
 * reworded, or because an uploaded preview drops it.
 *
 * Shown rather than discarded, matching how the capabilities view reports unmatched
 * question/capability links and how the question cards report unresolved upstream references.
 * CLAUDE.md §4: hiding known-bad data is worse than displaying it as unresolved.
 */
export function renderCommentOrphanNotice(
  orphans: Comment[],
  kind: CommentTargetKind,
): HTMLElement | undefined {
  if (orphans.length === 0) return undefined;

  return h(
    "div",
    { className: "notice notice--warning", role: "status" },
    h("strong", {}, "Comments on missing targets: "),
    `${String(orphans.length)} comment(s) refer to a ${ORPHAN_KIND_LABELS[kind]} that is not in ` +
      "the dataset currently displayed, so they are not attached to anything above. They are " +
      "listed here rather than hidden.",
    h(
      "ul",
      { className: "comment-list comment-list--orphaned" },
      ...orphans.map((comment) =>
        h(
          "li",
          { className: "comment comment--orphaned" },
          h(
            "p",
            { className: "comment__meta" },
            h("strong", { className: "comment__author" }, comment.author),
            h(
              "span",
              { className: "comment__orphan-target" },
              comment.targetLabel
                ? `on "${comment.targetLabel}"`
                : `on ${comment.kind} ${comment.id}`,
            ),
          ),
          h("p", { className: "comment__body" }, comment.body),
        ),
      ),
    ),
  );
}
