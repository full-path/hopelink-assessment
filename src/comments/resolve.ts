import type { Comment, CommentTarget, CommentTargetKind } from "./types";

/**
 * Attaching comments to the dataset currently on screen — pure, no DOM and no network, so it
 * can be tested against a synthetic dataset the way `summary.ts` and `capabilities.ts` are.
 *
 * The problem this solves: comment targets are slug ids, and question slugs are derived from
 * question text. Reword a question — in the source CSV, or in a session-only uploaded preview —
 * and every comment on it points at an id that no longer exists.
 *
 * The codebase already settled how to handle exactly this. `QuestionCapabilityLink` stores
 * question text and resolves it at render time specifically so a rename surfaces as unmatched
 * instead of rendering something stale, and the capabilities view prints those unmatched links
 * in a warning notice. Comments follow the same rule, which is CLAUDE.md §4's standing position:
 * hiding known-bad data is worse than displaying it as unresolved.
 */

/** Composite key for the by-target map, since ids are only unique within a kind. */
export type CommentTargetKey = string;

export function targetKey(target: CommentTarget): CommentTargetKey {
  return `${target.kind}:${target.id}`;
}

export interface ResolvedComments {
  /** Comments whose target exists in the active dataset, keyed by `targetKey`. */
  byTarget: Map<CommentTargetKey, Comment[]>;
  /**
   * Comments whose target does not exist in the active dataset, grouped by kind so each view
   * can report the orphans it is responsible for. Never silently dropped.
   */
  orphansByKind: Map<CommentTargetKind, Comment[]>;
  /** Total across every target, for the "N comments" summary line. */
  total: number;
}

export interface KnownTargets {
  questionIds: Set<string>;
  capabilityIds: Set<string>;
}

function isKnown(comment: Comment, known: KnownTargets): boolean {
  return comment.kind === "question"
    ? known.questionIds.has(comment.id)
    : known.capabilityIds.has(comment.id);
}

/** Oldest first, so a thread reads top to bottom like a conversation. */
function byTimestampAscending(a: Comment, b: Comment): number {
  return a.timestamp.localeCompare(b.timestamp);
}

export function resolveComments(comments: Comment[], known: KnownTargets): ResolvedComments {
  const byTarget = new Map<CommentTargetKey, Comment[]>();
  const orphansByKind = new Map<CommentTargetKind, Comment[]>();

  for (const comment of comments) {
    if (isKnown(comment, known)) {
      const key = targetKey(comment);
      const existing = byTarget.get(key);
      if (existing) existing.push(comment);
      else byTarget.set(key, [comment]);
    } else {
      const existing = orphansByKind.get(comment.kind);
      if (existing) existing.push(comment);
      else orphansByKind.set(comment.kind, [comment]);
    }
  }

  for (const thread of byTarget.values()) thread.sort(byTimestampAscending);
  for (const thread of orphansByKind.values()) thread.sort(byTimestampAscending);

  return { byTarget, orphansByKind, total: comments.length };
}

export function commentsFor(resolved: ResolvedComments, target: CommentTarget): Comment[] {
  return resolved.byTarget.get(targetKey(target)) ?? [];
}
