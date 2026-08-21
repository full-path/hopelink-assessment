// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A smoke test for the whole page, against the real committed dataset.
 *
 * The UI is hand-rolled DOM with no framework, so the failure mode this guards against is a
 * blank page: a throw inside `render()` leaves `#app` empty and every other test still passes.
 * It asserts the shape of what a reader actually sees rather than exact copy, so it doesn't
 * turn into a change-detector for wording.
 */

async function mountApp(): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import("./main");
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) throw new Error("#app missing after mount");
  return app;
}

interface StubComment {
  kind: string;
  id: string;
  timestamp: string;
  author: string;
  body: string;
  targetLabel: string;
}

/**
 * Mounts the app with commenting switched on, serving `comments` from a stubbed fetch.
 *
 * `main.ts` reads the endpoint at module scope, so the env has to be stubbed before the import
 * that `mountApp` performs.
 */
async function mountAppWithComments(comments: StubComment[]): Promise<HTMLElement> {
  vi.stubEnv("VITE_COMMENTS_ENDPOINT", "https://example.test/exec");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ comments }), { status: 200 })),
  );

  const app = await mountApp();
  // The comment fetch resolves after first paint and re-renders; wait for that second pass.
  // Keyed off the loading note rather than a rendered comment, so an empty list still settles.
  await vi.waitFor(() => {
    const loading = [...app.querySelectorAll(".comments .empty-note")].some((note) =>
      note.textContent.includes("Loading"),
    );
    if (loading) throw new Error("comments still loading");
  });
  return app;
}

function stubComment(overrides: Partial<StubComment> = {}): StubComment {
  return {
    kind: "question",
    id: "phone",
    timestamp: "2026-08-01T12:00:00.000Z",
    author: "Reviewer",
    body: "We collect this at booking, not at intake.",
    targetLabel: "Phone",
    ...overrides,
  };
}

function tab(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === name,
  );
  if (!found) throw new Error(`No tab labelled "${name}"`);
  return found;
}

describe("app render", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders the question list from the bundled dataset", async () => {
    const app = await mountApp();

    expect(app.querySelector("h1")?.textContent).toContain("Unified Intake Explorer");
    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(20);
    expect(app.querySelector(".result-count")?.textContent).toMatch(/Showing \d+ of \d+ questions/);
  });

  it("shows the capability panel on a question the map links to a capability", async () => {
    const app = await mountApp();

    const card = app.querySelector("#question-accessibility-needs");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".capability-panel")).not.toBeNull();
    expect(card?.querySelector(".capability-table")).not.toBeNull();
  });

  it("leaves questions with no capability link without a capability panel", async () => {
    const app = await mountApp();

    const card = app.querySelector("#question-phone");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".capability-panel")).toBeNull();
  });

  it("marks a differentiating question that few providers ask as a unified intake candidate", async () => {
    const app = await mountApp();

    const oxygen = app.querySelector("#question-do-you-require-portable-oxygen");
    expect(oxygen?.querySelector(".badge--candidate")).not.toBeNull();

    // Service animals: every responding provider says yes, so the question routes nobody.
    const serviceAnimal = app.querySelector("#question-do-you-require-a-service-animal");
    expect(serviceAnimal?.querySelector(".badge--candidate")).toBeNull();
  });

  it("switches to the capabilities view and renders the matrix and coverage table", async () => {
    const app = await mountApp();

    tab("Provider capabilities").click();

    expect(app.querySelector(".capability-matrix")).not.toBeNull();
    expect(app.querySelector(".coverage-table")).not.toBeNull();
    expect(app.querySelectorAll(".cap-variance").length).toBe(12);
    expect(tab("Provider capabilities").getAttribute("aria-selected")).toBe("true");
    expect(tab("Intake questions").getAttribute("aria-selected")).toBe("false");
  });

  it("narrows the list to unified intake candidates when that filter is chosen", async () => {
    const app = await mountApp();

    const select = app.querySelector<HTMLSelectElement>("#filter-capability");
    if (!select) throw new Error("capability filter missing");
    select.value = "candidate";
    select.dispatchEvent(new Event("change"));

    const cards = app.querySelectorAll(".question-card");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.querySelector(".badge--candidate")).not.toBeNull();
    }
  });

  it("renders fully with commenting disabled, and offers no comment form", async () => {
    // No VITE_COMMENTS_ENDPOINT is configured in the test environment, so the client is null.
    // That is a supported build, not a broken one: everything else must still be there.
    const app = await mountApp();

    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(20);
    expect(app.querySelectorAll(".comments").length).toBeGreaterThan(20);
    expect(app.querySelector(".comment-form")).toBeNull();
    expect(app.querySelector("#question-phone .comments")?.textContent).toContain(
      "Commenting is not configured",
    );
  });

  it("gives every capability a comment thread in the capabilities view", async () => {
    const app = await mountApp();
    tab("Provider capabilities").click();

    expect(app.querySelectorAll(".cap-variance").length).toBe(12);
    expect(app.querySelectorAll(".cap-variance__comments").length).toBe(12);
  });

  it("makes no network request when commenting is disabled", async () => {
    // The comment fetch must never be the reason a page load is slow or a test is flaky.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await mountApp();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("renders fetched comments on their question, with a form and a count badge", async () => {
    const app = await mountAppWithComments([stubComment()]);

    const card = app.querySelector("#question-phone");
    expect(card?.querySelector(".comment__body")?.textContent).toContain("not at intake");
    expect(card?.querySelector(".comment__author")?.textContent).toBe("Reviewer");
    expect(card?.querySelector(".comment-form")).not.toBeNull();
    expect(card?.querySelector(".badge--comments")?.textContent).toBe("1 comment");

    // A question nobody commented on gets a thread and a form. Its badge element exists — the
    // thread fills it in on a successful post — but is empty, and CSS hides an empty badge.
    const other = app.querySelector("#question-income");
    expect(other?.querySelector(".badge--comments")?.textContent).toBe("");
    expect(other?.querySelector(".comment-form")).not.toBeNull();
  });

  it("renders a comment body as text, never as markup", async () => {
    // Comment bodies are the only stored user-generated content in the app. If this ever fails,
    // the cause is a raw-HTML sink introduced in commentThread.ts — see the note at its top.
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const app = await mountAppWithComments([stubComment({ body: payload })]);

    const body = app.querySelector("#question-phone .comment__body");
    expect(body?.textContent).toBe(payload);
    expect(body?.querySelector("img")).toBeNull();
    expect(body?.querySelector("script")).toBeNull();
    expect(app.querySelectorAll("script").length).toBe(0);
  });

  it("reports a comment on a question that is not in the dataset instead of dropping it", async () => {
    const app = await mountAppWithComments([
      stubComment({ id: "a-question-that-was-reworded", targetLabel: "Old wording" }),
    ]);

    const notice = app.querySelector(".notice--warning");
    expect(notice?.textContent).toContain("Comments on missing targets");
    expect(notice?.textContent).toContain("Old wording");
    expect(app.querySelector(".comment--orphaned")).not.toBeNull();
  });

  it("keeps the analysis intact when the comment store is unreachable", async () => {
    vi.stubEnv("VITE_COMMENTS_ENDPOINT", "https://example.test/exec");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    const app = await mountApp();
    // Generous timeout: reads are retried with a backoff before the failure is reported, so this
    // deliberately takes about a second. See READ_ATTEMPTS in src/comments/client.ts.
    await vi.waitFor(
      () => {
        if (!app.querySelector(".comments__error")) throw new Error("error not rendered yet");
      },
      { timeout: 5000 },
    );

    expect(app.querySelector(".comments__error")?.textContent).toContain("Network down");
    // The product still works: a dead comment store must not cost the reader the analysis.
    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(20);
    expect(app.querySelector(".result-count")?.textContent).toMatch(/Showing \d+ of \d+/);
  });

  it("updates every count in place when a comment is posted, without collapsing the card", async () => {
    // Posting deliberately does not re-render — that would collapse the <details> the reader is
    // typing in — so each count has to be updated by hand. This is what regressed once already.
    const app = await mountAppWithComments([]);

    const card = app.querySelector<HTMLDetailsElement>("#question-phone");
    if (!card) throw new Error("question card missing");
    card.open = true;

    expect(card.querySelector(".badge--comments")?.textContent).toBe("");
    expect(card.querySelector(".comments h4")?.textContent).toBe("Comments");

    const posted = {
      kind: "question",
      id: "phone",
      timestamp: "2026-08-21T10:00:00.000Z",
      author: "Reviewer",
      body: "Posted just now.",
      targetLabel: "Phone",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ comment: posted }), { status: 200 })),
    );

    const form = card.querySelector<HTMLFormElement>(".comment-form");
    const author = card.querySelector<HTMLInputElement>('input[name="author"]');
    const body = card.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    const passphrase = card.querySelector<HTMLInputElement>('input[name="passphrase"]');
    if (!form || !author || !body || !passphrase) throw new Error("comment form incomplete");

    author.value = "Reviewer";
    body.value = "Posted just now.";
    passphrase.value = "secret";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      if (card.querySelector(".badge--comments")?.textContent !== "1 comment") {
        throw new Error("badge not updated yet");
      }
    });

    expect(card.querySelector(".comments h4")?.textContent).toBe("Comments (1)");
    expect(card.querySelector(".comment__body")?.textContent).toBe("Posted just now.");
    // The card must still be open — the whole reason the post path avoids a re-render.
    expect(card.open).toBe(true);
  });

  it("updates a capability row's count in place when a comment is posted there", async () => {
    const app = await mountAppWithComments([]);
    tab("Provider capabilities").click();

    const row = app.querySelector<HTMLDetailsElement>(".cap-variance__comments");
    if (!row) throw new Error("capability comment row missing");
    row.open = true;

    const summary = row.querySelector("summary");
    expect(summary?.textContent).toBe("Comments");

    const capabilityId = row
      .querySelector(".comments")
      ?.getAttribute("aria-labelledby")
      ?.replace("comments-capability-", "")
      .replace("-heading", "");
    if (!capabilityId) throw new Error("could not determine capability id");

    const posted = {
      kind: "capability",
      id: capabilityId,
      timestamp: "2026-08-21T10:00:00.000Z",
      author: "Reviewer",
      body: "Two of our vans have lifts.",
      targetLabel: "Lift",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ comment: posted }), { status: 200 })),
    );

    const form = row.querySelector<HTMLFormElement>(".comment-form");
    const author = row.querySelector<HTMLInputElement>('input[name="author"]');
    const body = row.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    const passphrase = row.querySelector<HTMLInputElement>('input[name="passphrase"]');
    if (!form || !author || !body || !passphrase) throw new Error("comment form incomplete");

    author.value = "Reviewer";
    body.value = "Two of our vans have lifts.";
    passphrase.value = "secret";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      if (row.querySelector("summary")?.textContent !== "Comments (1)") {
        throw new Error("summary not updated yet");
      }
    });

    expect(row.querySelector(".comments h4")?.textContent).toBe("Comments (1)");
    expect(row.open).toBe(true);
  });
});
