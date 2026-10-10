// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_FILES, SOURCE_ROLES, type SourceTexts } from "./data/dataset";
import type { SheetTabs } from "./sheetSource";

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

  it("marks a unified intake candidate in the capability panel, not in the header", async () => {
    const app = await mountApp();

    const oxygen = app.querySelector("#question-do-you-require-portable-oxygen");
    // The finding is still made, inside the panel, where there is room to explain it.
    expect(oxygen?.querySelector(".capability-panel .badge--candidate")).not.toBeNull();
    expect(oxygen?.querySelector(".capability-panel__coverage")?.textContent).toContain(
      "still need the answer to route a rider",
    );
    // But it is no longer advertised on the collapsed summary line.
    expect(oxygen?.querySelector(".question-card__summary .badge--candidate")).toBeNull();

    // Service animals: every responding provider says yes, so the question routes nobody.
    const serviceAnimal = app.querySelector("#question-do-you-require-a-service-animal");
    expect(serviceAnimal?.querySelector(".badge--candidate")).toBeNull();
  });

  it("puts no candidate badge on any question header", async () => {
    const app = await mountApp();

    expect(app.querySelectorAll(".question-card__summary .badge--candidate").length).toBe(0);
    // The concept is not gone, only moved: some panel still carries it.
    expect(app.querySelectorAll(".capability-panel .badge--candidate").length).toBeGreaterThan(0);
  });

  it("shows how many agencies ask each question on every header", async () => {
    const app = await mountApp();

    const badges = app.querySelectorAll(".question-card__summary .badge--agency-count");
    expect(badges.length).toBe(app.querySelectorAll(".question-card").length);
    for (const badge of badges) {
      expect(badge.textContent).toMatch(/^Asked by \d+ of 16 agencies$/);
    }

    // Distinct agencies, not requirement rows: Email names 15 agencies across its columns, and
    // several of them appear in more than one column for it.
    expect(
      app.querySelector("#question-email .question-card__summary .badge--agency-count")
        ?.textContent,
    ).toBe("Asked by 15 of 16 agencies");

    // Zero is shown rather than hidden — unlike the comment badge, nobody asking is a finding.
    expect(
      app.querySelector(
        "#question-mailing-address-same-as-home-address .question-card__summary .badge--agency-count",
      )?.textContent,
    ).toBe("Asked by 0 of 16 agencies");
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
      expect(card.querySelector(".capability-panel .badge--candidate")).not.toBeNull();
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

  it("shows a data quality note in the question body but never as a header badge", async () => {
    const app = await mountApp();

    // Roughly half the rows carry a note, so plenty of cards should show one in the body...
    expect(app.querySelectorAll(".data-quality-note").length).toBeGreaterThan(10);
    // ...and none should advertise it on the collapsed summary line.
    expect(app.querySelector(".badge--note")).toBeNull();
    for (const summary of app.querySelectorAll(".question-card__summary")) {
      expect(summary.textContent).not.toContain("Data quality note");
    }

    // The note itself is still labelled where it is rendered.
    const note = app.querySelector("#question-home-address .data-quality-note");
    expect(note?.textContent).toContain("Data quality note:");
  });

  it("resolves the mailing-address chain rather than flagging it unresolved", async () => {
    const app = await mountApp();

    const added = app.querySelector("#question-mailing-address-same-as-home-address");
    expect(added).not.toBeNull();

    // Both neighbours previously had a dangling reference to this question.
    for (const id of ["#question-home-address", "#question-mailing-address"]) {
      const card = app.querySelector(id);
      expect(card?.querySelector(".link-item--unresolved")).toBeNull();
      expect(card?.querySelector(".link-item--resolved a")?.getAttribute("href")).toBe(
        "#question-mailing-address-same-as-home-address",
      );
    }
  });

  it("declines to propose a requirement level for a question no agency reports", async () => {
    // The added question has no agency data. Taking a mode over an empty set would print a
    // confident "Requires documentary proof", which would read as a finding rather than a gap.
    const app = await mountApp();
    const card = app.querySelector("#question-mailing-address-same-as-home-address");

    const summary = card?.querySelector(".summary");
    expect(summary?.textContent).toContain("no basis for proposing");
    expect(summary?.textContent).not.toContain("Proposed unified requirement level");
    expect(card?.querySelector(".requirements-table")).toBeNull();
  });

  it("has no unresolved links left in the committed dataset", async () => {
    const app = await mountApp();

    expect(app.querySelectorAll(".link-item--unresolved").length).toBe(0);
    expect(app.querySelector(".badge--warning")).toBeNull();
    // Resolved chains are still rendered — this asserts an absence of warnings, not of links.
    expect(app.querySelectorAll(".link-item--resolved").length).toBeGreaterThan(0);
  });

  it("no longer offers an unresolved-links filter", async () => {
    const app = await mountApp();

    expect(app.querySelector("#filter-unresolved")).toBeNull();
    expect(app.textContent).not.toContain("unresolved links");
    // Removing the filter does not remove the reporting: unresolved links still render as
    // flagged wherever they occur (CLAUDE.md §11 item 2), there just are none right now.
    expect(app.querySelectorAll(".link-item--unresolved").length).toBe(0);
  });

  it("empties out cleanly when a filter combination matches nothing", async () => {
    // Zip Shuttle only ever marks questions "Required", so pairing it with "Proof Required"
    // yields nothing. Previously covered via the unresolved filter, kept because an empty
    // result must render a note rather than a broken list.
    const app = await mountApp();

    const box = app.querySelector<HTMLInputElement>("#filter-agency-zip-shuttle");
    if (!box) throw new Error("agency checkbox missing");
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(0);

    const level = app.querySelector<HTMLSelectElement>("#filter-level");
    if (!level) throw new Error("level filter missing");
    level.value = "proof_required";
    level.dispatchEvent(new Event("change"));

    expect(app.querySelectorAll(".question-card").length).toBe(0);
    expect(app.querySelector(".empty-note")?.textContent).toContain("No questions match");
    expect(app.querySelector(".result-count")?.textContent).toContain("Showing 0 of 43");
  });

  it("still links Accessibility needs to its capabilities after dropping the dangling reference", async () => {
    // The removed Downstream cell gestured at capability data; that relationship lives in
    // question-capability-map.csv and must be unaffected.
    const app = await mountApp();

    const card = app.querySelector("#question-accessibility-needs");
    expect(card?.querySelector(".capability-panel")).not.toBeNull();
    expect(card?.querySelectorAll(".capability-table tbody tr").length).toBe(6);
    expect(card?.querySelector(".capability-panel .badge--candidate")).not.toBeNull();
    // The dangling reference is gone: nothing unresolved. What remains are the links other
    // questions declare to it, which the Question links tab now shows from both ends.
    expect(card?.querySelector(".link-item--unresolved")).toBeNull();
    const downstream = [...(card?.querySelectorAll(".link-item--resolved a") ?? [])].map((a) =>
      a.getAttribute("href"),
    );
    expect(downstream).toContain("#question-do-you-need-an-interpreter");
    expect(downstream).toHaveLength(5);
  });

  function boxes(app: HTMLElement, questionId: string): HTMLElement[] {
    return [
      ...app.querySelectorAll<HTMLElement>(
        `#question-${questionId} .question-card__summary .agency-strip .agency-box`,
      ),
    ];
  }

  it("renders one box per agency on every question header", async () => {
    const app = await mountApp();

    const strips = app.querySelectorAll(".question-card__summary .agency-strip");
    expect(strips.length).toBe(app.querySelectorAll(".question-card").length);
    for (const strip of strips) {
      expect(strip.querySelectorAll(".agency-box").length).toBe(16);
    }
  });

  it("keeps box position mapped to the same agency across cards", async () => {
    // The whole point of the strip: position means "this agency" only if it is identical on
    // every card, so a reader can scan a column down the list.
    const app = await mountApp();

    const names = (id: string) =>
      boxes(app, id).map((b) => (b.getAttribute("data-tip") ?? "").split(" — ")[0]);

    const reference = names("income");
    expect(reference[0]).toBe("Hyde Shuttle");
    expect(reference[5]).toBe("ORCA");
    expect(reference[15]).toBe("Zip Shuttle");
    expect(names("email")).toEqual(reference);
    expect(names("mailing-address-same-as-home-address")).toEqual(reference);
  });

  it("colours each box by the agency's effective requirement level", async () => {
    // Income exercises every state: proof, required, self-attestation, optional, not asked.
    const app = await mountApp();
    const cls = (i: number) => boxes(app, "income")[i]?.getAttribute("class");

    expect(cls(0)).toContain("agency-box--self_attestation"); // Hyde Shuttle
    expect(cls(2)).toContain("agency-box--required"); // Beyond the Borders
    expect(cls(8)).toContain("agency-box--proof_required"); // ORCA LIFT
    expect(cls(10)).toContain("agency-box--optional"); // Sound Generations VTS
    expect(cls(1)).toContain("agency-box--not-asked"); // Northshore Senior Center
    expect(cls(5)).toContain("agency-box--not-asked"); // bare ORCA: the proof is ORCA LIFT's
  });

  it("takes the strictest level when an agency appears in several columns", async () => {
    // ORCA LIFT is Required on Income and also requires proof. One agency with two entries is
    // still one box, and proof is the stricter posture.
    const app = await mountApp();
    const orcaLift = boxes(app, "income")[8];

    expect(orcaLift?.getAttribute("class")).toContain("agency-box--proof_required");
    expect(orcaLift?.getAttribute("class")).not.toContain("agency-box--required");
  });

  it("puts agency, level, and proof detail in each box's tooltip", async () => {
    const app = await mountApp();
    const tip = (i: number) => boxes(app, "income")[i]?.getAttribute("data-tip") ?? "";

    expect(tip(0)).toBe("Hyde Shuttle — Self-Attestation");
    expect(tip(1)).toBe("Northshore Senior Center — Not asked");

    const orcaLift = tip(8);
    expect(orcaLift.startsWith("ORCA LIFT — Proof Required")).toBe(true);
    expect(orcaLift).toContain("Proof: ProviderOne number OR EBT number");

    // A question nobody asks: every box says so rather than being blank.
    for (const box of boxes(app, "mailing-address-same-as-home-address")) {
      expect(box.getAttribute("data-tip")).toContain("Not asked");
    }
  });

  it("gives the strip a single accessible label instead of 16 bare boxes", async () => {
    const app = await mountApp();
    const strip = app.querySelector("#question-income .agency-strip");

    expect(strip?.getAttribute("role")).toBe("img");
    const label = strip?.getAttribute("aria-label") ?? "";
    expect(label).toContain("1 proof required");
    expect(label).toContain("2 required");
    expect(label).toContain("11 not asked");
  });

  it("says when an agency never stated whether it asks a question as required or optional", async () => {
    // Email: bare ORCA accepts self-attestation but its Asked is Unknown. The box shows the level
    // it did state, and both the tooltip and the requirements table say what is missing.
    const app = await mountApp();

    expect(boxes(app, "email")[5]?.getAttribute("data-tip")).toBe(
      "ORCA — Self-Attestation\nNot stated whether required or optional",
    );
    const rows = [...app.querySelectorAll("#question-email .requirements-table tbody tr")];
    const orcaRow = rows.find((row) => row.querySelector("td")?.textContent === "ORCA");
    expect(orcaRow?.textContent).toContain(
      "Self-Attestation — not stated whether required or optional",
    );
  });

  it("renders a legend for the strip once above the list", async () => {
    // 16 boxes in 5 colours are unreadable without a key, so it is part of the feature.
    const app = await mountApp();

    const legends = app.querySelectorAll(".agency-legend");
    expect(legends.length).toBe(1);
    expect(legends[0]?.querySelectorAll(".agency-legend__item").length).toBe(5);
    expect(legends[0]?.textContent).toContain("16 agencies");
    expect(legends[0]?.textContent).toContain("Hover a box");
  });

  function pickAgency(app: HTMLElement, agencyId: string): void {
    const box = app.querySelector<HTMLInputElement>(`#filter-agency-${agencyId}`);
    if (!box) throw new Error(`no agency checkbox for ${agencyId}`);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
  }

  function toggleGroup(app: HTMLElement, groupId: string, checked: boolean): void {
    const box = app.querySelector<HTMLInputElement>(`#filter-group-${groupId}`);
    if (!box) throw new Error(`no group checkbox for ${groupId}`);
    box.checked = checked;
    box.dispatchEvent(new Event("change"));
  }

  it("shows and hides a staff-defined group of agencies as a unit", async () => {
    const app = await mountApp();
    const total = app.querySelectorAll(".question-card").length;

    toggleGroup(app, "orca-programs", true);
    expect(app.querySelector("#filter-agency summary")?.textContent).toBe(
      "Agency: ORCA programs (4 of 16)",
    );
    for (const id of ["orca", "orca-senior", "orca-disabled", "orca-lift"]) {
      expect(app.querySelector<HTMLInputElement>(`#filter-agency-${id}`)?.checked).toBe(true);
    }
    expect(boxes(app, "phone")).toHaveLength(4);
    expect(app.querySelectorAll(".question-card").length).toBeLessThan(total);

    toggleGroup(app, "orca-programs", false);
    expect(app.querySelector("#filter-agency summary")?.textContent).toBe("Agency: all 16");
    expect(app.querySelectorAll(".question-card").length).toBe(total);
  });

  it("reads a group's state back from its members: indeterminate when only some are selected", async () => {
    const app = await mountApp();

    pickAgency(app, "orca-lift");
    const group = app.querySelector<HTMLInputElement>("#filter-group-orca-programs");
    expect(group?.checked).toBe(false);
    expect(group?.indeterminate).toBe(true);

    // Ticking it completes the set rather than toggling the one already chosen off.
    toggleGroup(app, "orca-programs", true);
    expect(app.querySelector("#filter-agency summary")?.textContent).toContain("ORCA programs");
  });

  it("counts only group members that have intake data, and lists only groups with any", async () => {
    // Pierce Transit SHUTTLE is a paratransit provider but asks no intake questions, so it has
    // no checkbox here; the group still offers its one listed member.
    const app = await mountApp();
    expect(app.querySelector('label[for="filter-group-paratransit-providers"]')?.textContent).toBe(
      "Paratransit providers (1)",
    );
  });

  it("offers every agency as a checkbox rather than a single-choice dropdown", async () => {
    const app = await mountApp();

    expect(app.querySelector("select#filter-agency")).toBeNull();
    const group = app.querySelector("#filter-agency");
    expect(group?.querySelectorAll('.filters__agency-list input[type="checkbox"]').length).toBe(16);
    expect(group?.querySelector("summary")?.textContent).toBe("Agency: all 16");
  });

  it("narrows the list to questions asked by any selected agency", async () => {
    const app = await mountApp();
    const total = app.querySelectorAll(".question-card").length;

    pickAgency(app, "zip-shuttle");
    const afterOne = app.querySelectorAll(".question-card").length;
    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThan(total);

    // Selections are a union, so adding one can only widen the result.
    pickAgency(app, "hyde-shuttle");
    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(afterOne);
    expect(app.querySelector("#filter-agency summary")?.textContent).toBe(
      "Agency: 2 of 16 selected",
    );
  });

  it("shows only the selected agencies' boxes, in roster order", async () => {
    const app = await mountApp();

    // Ticked in reverse roster order on purpose: the strip must not follow click order.
    pickAgency(app, "zip-shuttle");
    pickAgency(app, "hyde-shuttle");

    const strip = app.querySelectorAll(".question-card")[0]?.querySelectorAll(".agency-box");
    expect(strip?.length).toBe(2);
    expect(strip?.[0]?.getAttribute("data-tip")).toContain("Hyde Shuttle");
    expect(strip?.[1]?.getAttribute("data-tip")).toContain("Zip Shuttle");

    // Every card agrees, which is what makes a column scannable.
    for (const card of app.querySelectorAll(".question-card")) {
      const boxes = card.querySelectorAll(".agency-box");
      expect(boxes.length).toBe(2);
      expect(boxes[0]?.getAttribute("data-tip")).toContain("Hyde Shuttle");
    }
  });

  it("counts against the selection so the badge and the boxes agree", async () => {
    const app = await mountApp();
    pickAgency(app, "hyde-shuttle");

    const card = app.querySelector("#question-income");
    expect(card?.querySelector(".badge--agency-count")?.textContent).toBe(
      "Asked by 1 of 1 selected agencies",
    );
    expect(card?.querySelectorAll(".agency-box").length).toBe(1);

    expect(app.querySelector(".agency-legend")?.textContent).toContain("one box per selected");
  });

  it("keeps the standardization summary on the full population while filtered", async () => {
    // The strip is a display and narrows; the summary is an analysis whose proposed level is a
    // mode across agencies, so a hand-picked subset must not reach it.
    const app = await mountApp();
    const postureCount = () =>
      app.querySelectorAll("#question-income .summary .posture-group li").length;

    const before = postureCount();
    pickAgency(app, "hyde-shuttle");
    expect(postureCount()).toBe(before);
    expect(before).toBe(16);
  });

  it("restores everything when the selection is cleared", async () => {
    const app = await mountApp();
    const total = app.querySelectorAll(".question-card").length;

    pickAgency(app, "zip-shuttle");
    expect(app.querySelectorAll(".question-card").length).toBeLessThan(total);

    const clear = app.querySelector<HTMLButtonElement>("#filter-agency-clear");
    expect(clear?.disabled).toBe(false);
    clear?.click();

    expect(app.querySelectorAll(".question-card").length).toBe(total);
    expect(app.querySelectorAll(".question-card")[0]?.querySelectorAll(".agency-box").length).toBe(
      16,
    );
    expect(app.querySelector("#filter-agency summary")?.textContent).toBe("Agency: all 16");
    expect(app.querySelector<HTMLButtonElement>("#filter-agency-clear")?.disabled).toBe(true);
  });

  it("hides the replacement-CSV control by default", async () => {
    const app = await mountApp();

    expect(app.querySelector(".data-source")).toBeNull();
    expect(app.querySelector("#data-source-file")).toBeNull();
    expect(app.textContent).not.toContain("Preview replacement CSVs");
    // The rest of the page is unaffected.
    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(20);
    expect(app.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("restores the replacement-CSV control when the build flag is set", async () => {
    // The point of hiding it behind a flag rather than deleting it: the upload path is still
    // wired up and one env var away, not waiting to be rebuilt from scratch.
    vi.stubEnv("VITE_SHOW_CSV_UPLOAD", "true");
    const app = await mountApp();

    expect(app.querySelector(".data-source")).not.toBeNull();
    expect(app.querySelector<HTMLInputElement>("#data-source-file")?.type).toBe("file");
    expect(app.textContent).toContain("Preview replacement CSVs");
  });

  it("puts the agency strip last in every header so the boxes form a column", async () => {
    // This is what makes the strips comparable between questions: anything of variable width
    // after the strip shifts it sideways by a different amount on each card.
    const app = await mountAppWithComments([stubComment({ id: "phone" })]);

    const summaries = app.querySelectorAll(".question-card__summary");
    expect(summaries.length).toBeGreaterThan(20);
    for (const summary of summaries) {
      expect(summary.lastElementChild?.classList.contains("agency-strip")).toBe(true);
    }

    // On a card that has a comment badge, it comes before the count, not after the strip.
    const classesOf = (id: string) =>
      [...(app.querySelector(`#question-${id} .question-card__summary`)?.children ?? [])].map(
        (el) => el.className,
      );

    const phone = classesOf("phone");
    expect(phone.some((c) => c.includes("badge--comments"))).toBe(true);
    expect(phone.findIndex((c) => c.includes("badge--comments"))).toBeLessThan(
      phone.findIndex((c) => c.includes("badge--agency-count")),
    );
    expect(phone[phone.length - 1]).toContain("agency-strip");
    expect(phone[0]).toContain("question-card__text");
  });

  it("uses data-tip rather than title so the tooltip is not delayed", async () => {
    // `title` is drawn by the browser after roughly half a second and the delay cannot be
    // configured. Reintroducing it would also double the tooltip, since the CSS one stays.
    const app = await mountApp();

    const stripBoxes = app.querySelectorAll(".agency-strip .agency-box");
    expect(stripBoxes.length).toBeGreaterThan(100);
    for (const box of stripBoxes) {
      expect(box.hasAttribute("title")).toBe(false);
      expect((box.getAttribute("data-tip") ?? "").length).toBeGreaterThan(0);
    }

    // The legend reuses the same class for its swatches; those carry no tooltip, and the CSS
    // rule is scoped to strips so they do not show an empty one.
    for (const swatch of app.querySelectorAll(".agency-legend .agency-box")) {
      expect(swatch.hasAttribute("data-tip")).toBe(false);
    }
  });
});

describe("live sheet", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");
  const PUBLISHED = "https://docs.google.com/spreadsheets/d/e/2PACX-test/pub";
  /** Each role's tab, wired to a gid; the committed src/sheetTabs.ts has none until a sheet exists. */
  const WIRED = Object.fromEntries(
    SOURCE_ROLES.map((role, gid) => [role, { name: role, gid }]),
  ) as SheetTabs;
  const urlFor = (role: keyof SourceTexts) =>
    `${PUBLISHED}?gid=${String(WIRED[role].gid)}&single=true&output=csv`;
  const COMMITTED = Object.fromEntries(
    SOURCE_ROLES.map((role) => [role, read(`../data/${SOURCE_FILES[role]}`)]),
  ) as Record<keyof SourceTexts, string>;

  /**
   * Mounts the app with the sheet configured and its fetches held until `release()`, so a test
   * can put the page into a given state (a card open, say) before the sheet answers — which is
   * the window the swap logic exists to handle. `overrides` replaces individual tabs.
   */
  async function mountWithSheet(overrides: Partial<Record<keyof SourceTexts, string>> = {}) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubEnv("VITE_SHEET_PUBLISHED_URL", PUBLISHED);
    vi.doMock("./sheetTabs", () => ({ SHEET_TABS: WIRED }));
    const bodies = new Map(
      SOURCE_ROLES.map((role) => [urlFor(role), overrides[role] ?? COMMITTED[role]]),
    );

    const fetchMock = vi.fn(async (url: string) => {
      await gate;
      return new Response(bodies.get(url) ?? "", { status: bodies.has(url) ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = await mountApp();
    return { app, fetchMock, release };
  }

  const statusText = (app: HTMLElement) => app.querySelector(".sheet-status")?.textContent ?? "";
  const withAddedQuestion = () => ({
    questions: `${COMMITTED.questions}do-you-travel-with-a-bicycle,Do you travel with a bicycle,\n`,
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("./sheetTabs");
  });

  it("makes no request and shows no status line when no sheet is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = await mountApp();

    expect(app.querySelector(".sheet-status")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("paints the snapshot before the sheet answers", async () => {
    const { app } = await mountWithSheet();

    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(20);
    expect(statusText(app)).toContain("Checking the live sheet");
  });

  it("only updates the status line when the sheet matches the snapshot", async () => {
    const { app, release } = await mountWithSheet();
    const card = app.querySelector<HTMLDetailsElement>("#question-phone");
    if (card) card.open = true;

    release();
    await vi.waitFor(() => {
      expect(statusText(app)).toContain("Showing live data");
    });
    // Same element, still open: nothing was re-rendered.
    expect(app.querySelector("#question-phone")).toBe(card);
    expect(card?.open).toBe(true);
  });

  it("applies a changed sheet at once when the reader is idle", async () => {
    const { app, release } = await mountWithSheet(withAddedQuestion());
    expect(app.querySelector("#question-do-you-travel-with-a-bicycle")).toBeNull();

    release();
    await vi.waitFor(() => {
      expect(app.querySelector("#question-do-you-travel-with-a-bicycle")).not.toBeNull();
    });
    expect(statusText(app)).toContain("Showing live data");
  });

  it("offers a changed sheet instead of collapsing a card the reader has open", async () => {
    const { app, release } = await mountWithSheet(withAddedQuestion());
    const card = app.querySelector<HTMLDetailsElement>("#question-phone");
    if (card) card.open = true;

    release();
    await vi.waitFor(() => {
      expect(statusText(app)).toContain("updated since this page was published");
    });
    expect(card?.open).toBe(true);
    expect(app.querySelector("#question-do-you-travel-with-a-bicycle")).toBeNull();

    app.querySelector<HTMLButtonElement>(".sheet-status__apply")?.click();
    expect(app.querySelector("#question-do-you-travel-with-a-bicycle")).not.toBeNull();
    expect(statusText(app)).toContain("Showing live data");
  });

  it("keeps the snapshot and says why when the sheet is invalid", async () => {
    const { app, release } = await mountWithSheet({
      requirements: `${COMMITTED.requirements}phone,Unlisted Agency,Required,,\n`,
    });
    const before = app.querySelectorAll(".question-card").length;

    release();
    await vi.waitFor(() => {
      expect(app.querySelector(".sheet-status--error")).not.toBeNull();
    });
    expect(statusText(app)).toContain('Unrecognized agency name "Unlisted Agency"');
    expect(app.querySelectorAll(".question-card").length).toBe(before);
  });

  it("keeps a comment attached when its question is reworded in the sheet", async () => {
    // Question ids are assigned in the sheet rather than derived from the text, so rewording a
    // question no longer orphans the discussion about it.
    vi.stubEnv("VITE_COMMENTS_ENDPOINT", "https://example.test/exec");
    vi.stubEnv("VITE_SHEET_PUBLISHED_URL", PUBLISHED);
    vi.doMock("./sheetTabs", () => ({ SHEET_TABS: WIRED }));
    const questions = COMMITTED.questions.replace(/^phone,Phone,/m, "phone,Telephone number,");
    const bodies = new Map(
      SOURCE_ROLES.map((role) => [
        urlFor(role),
        role === "questions" ? questions : COMMITTED[role],
      ]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          bodies.has(url)
            ? new Response(bodies.get(url))
            : new Response(JSON.stringify({ comments: [stubComment()] })),
        ),
      ),
    );

    const app = await mountApp();
    await vi.waitFor(() => {
      expect(app.querySelector("#question-phone .question-card__text")?.textContent).toBe(
        "Telephone number",
      );
    });
    await vi.waitFor(() => {
      expect(app.querySelector("#question-phone .comment__body")).not.toBeNull();
    });
    expect(app.querySelector(".comment--orphaned")).toBeNull();
  });

  it("reports a partly configured sheet without fetching any of it", async () => {
    // A published URL, but the committed src/sheetTabs.ts has no gids yet.
    vi.stubEnv("VITE_SHEET_PUBLISHED_URL", PUBLISHED);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = await mountApp();

    expect(statusText(app)).toContain("only partly configured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(app.querySelectorAll(".question-card").length).toBeGreaterThan(20);
  });
});
