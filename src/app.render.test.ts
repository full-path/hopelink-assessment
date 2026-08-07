// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
