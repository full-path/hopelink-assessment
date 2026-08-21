import { describe, expect, it } from "vitest";
import { commentsFor, resolveComments, targetKey, type KnownTargets } from "./resolve";
import type { Comment } from "./types";

function comment(overrides: Partial<Comment> & Pick<Comment, "kind" | "id">): Comment {
  return {
    timestamp: "2026-08-01T00:00:00.000Z",
    author: "Reviewer",
    body: "A comment.",
    targetLabel: "Some label",
    ...overrides,
  };
}

const known: KnownTargets = {
  questionIds: new Set(["income", "disabled"]),
  capabilityIds: new Set(["lift", "ramp"]),
};

describe("targetKey", () => {
  it("keeps question and capability ids in separate namespaces", () => {
    // Nothing stops a question slug and a capability slug from colliding — both are slugified
    // free text — so the kind has to be part of the key.
    expect(targetKey({ kind: "question", id: "lift" })).not.toBe(
      targetKey({ kind: "capability", id: "lift" }),
    );
  });
});

describe("resolveComments", () => {
  it("groups comments by their target", () => {
    const resolved = resolveComments(
      [
        comment({ kind: "question", id: "income", body: "first" }),
        comment({ kind: "question", id: "income", body: "second" }),
        comment({ kind: "capability", id: "lift", body: "third" }),
      ],
      known,
    );

    expect(commentsFor(resolved, { kind: "question", id: "income" })).toHaveLength(2);
    expect(commentsFor(resolved, { kind: "capability", id: "lift" })).toHaveLength(1);
    expect(resolved.total).toBe(3);
    expect(resolved.orphansByKind.size).toBe(0);
  });

  it("does not leak a comment across kinds that share an id", () => {
    const resolved = resolveComments(
      [comment({ kind: "capability", id: "lift", body: "capability comment" })],
      known,
    );

    expect(commentsFor(resolved, { kind: "question", id: "lift" })).toHaveLength(0);
    expect(commentsFor(resolved, { kind: "capability", id: "lift" })).toHaveLength(1);
  });

  it("orders each thread oldest first", () => {
    const resolved = resolveComments(
      [
        comment({ kind: "question", id: "income", timestamp: "2026-08-03T00:00:00Z", body: "c" }),
        comment({ kind: "question", id: "income", timestamp: "2026-08-01T00:00:00Z", body: "a" }),
        comment({ kind: "question", id: "income", timestamp: "2026-08-02T00:00:00Z", body: "b" }),
      ],
      known,
    );

    expect(commentsFor(resolved, { kind: "question", id: "income" }).map((c) => c.body)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns an empty thread for a known target nobody has commented on", () => {
    const resolved = resolveComments([], known);
    expect(commentsFor(resolved, { kind: "question", id: "disabled" })).toEqual([]);
  });

  it("reports a comment on an unknown target as an orphan rather than dropping it", () => {
    const resolved = resolveComments(
      [comment({ kind: "question", id: "not-in-dataset", body: "orphaned" })],
      known,
    );

    expect(resolved.byTarget.size).toBe(0);
    expect(resolved.orphansByKind.get("question")).toHaveLength(1);
    expect(resolved.total).toBe(1);
  });

  it("orphans a comment when its question is reworded, instead of reattaching it", () => {
    // The real scenario this guards: question ids are slugs of question text, so an edited CSV
    // (or a session-only uploaded preview) changes the id out from under existing comments.
    // The comment must surface as unresolved, never silently attach to a neighbouring question.
    const beforeRename: KnownTargets = {
      questionIds: new Set(["do-you-use-a-wheelchair"]),
      capabilityIds: new Set(),
    };
    const afterRename: KnownTargets = {
      questionIds: new Set(["do-you-use-a-mobility-device"]),
      capabilityIds: new Set(),
    };
    const existing = [comment({ kind: "question", id: "do-you-use-a-wheelchair" })];

    expect(resolveComments(existing, beforeRename).orphansByKind.size).toBe(0);

    const after = resolveComments(existing, afterRename);
    expect(after.byTarget.size).toBe(0);
    expect(after.orphansByKind.get("question")).toHaveLength(1);
    expect(commentsFor(after, { kind: "question", id: "do-you-use-a-mobility-device" })).toEqual(
      [],
    );
  });

  it("groups orphans by kind so each view reports only its own", () => {
    const resolved = resolveComments(
      [
        comment({ kind: "question", id: "gone" }),
        comment({ kind: "capability", id: "also-gone" }),
        comment({ kind: "capability", id: "gone-too" }),
      ],
      known,
    );

    expect(resolved.orphansByKind.get("question")).toHaveLength(1);
    expect(resolved.orphansByKind.get("capability")).toHaveLength(2);
  });
});
