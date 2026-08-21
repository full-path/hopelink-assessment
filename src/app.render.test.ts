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
  await vi.waitFor(() => {
    if (!app.querySelector(".comment")) throw new Error("comments not rendered yet");
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

    // A question nobody commented on gets a thread and a form, but no badge.
    const other = app.querySelector("#question-income");
    expect(other?.querySelector(".badge--comments")).toBeNull();
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
    await vi.waitFor(() => {
      if (!app.querySelector(".comments__error")) throw new Error("error not rendered yet");
    });

    expect(app.querySelector(".comments__error")?.textContent).toContain("Network down");
    // The product still works: a dead comment store must not cost the reader the analysis.
    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(20);
    expect(app.querySelector(".result-count")?.textContent).toMatch(/Showing \d+ of \d+/);
  });
});
