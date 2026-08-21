import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommentsClient } from "./client";
import type { NewComment } from "./types";

const ENDPOINT = "https://script.google.com/macros/s/example/exec";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function client() {
  const created = createCommentsClient(ENDPOINT);
  if (!created) throw new Error("expected a client for a non-empty endpoint");
  return created;
}

const draft: NewComment = {
  kind: "question",
  id: "income",
  author: "Reviewer",
  body: "We ask for this at intake, not after.",
  targetLabel: "Income",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createCommentsClient", () => {
  it("returns null when no endpoint is configured", () => {
    // The no-endpoint build is a supported state, not an error: it disables commenting and
    // leaves the rest of the app untouched.
    expect(createCommentsClient(undefined)).toBeNull();
    expect(createCommentsClient("")).toBeNull();
    expect(createCommentsClient("   ")).toBeNull();
  });
});

describe("list", () => {
  it("parses comments from the store", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          comments: [
            {
              kind: "question",
              id: "income",
              timestamp: "2026-08-01T00:00:00.000Z",
              author: "Reviewer",
              body: "Noted.",
              targetLabel: "Income",
            },
          ],
        }),
      ),
    );

    const comments = await client().list();
    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe("income");
  });

  it("skips malformed rows rather than failing the whole fetch", async () => {
    // The sheet is hand-edited by program staff. One row with a mistyped kind or a missing body
    // must not cost the reader every other comment on the page.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          comments: [
            { kind: "nonsense", id: "income", body: "wrong kind" },
            { kind: "question", id: "", body: "no id" },
            { kind: "question", id: "income", body: "" },
            { kind: "question", id: "income", body: "good" },
          ],
        }),
      ),
    );

    const comments = await client().list();
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("good");
  });

  it("defaults a missing author rather than rendering a blank byline", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ comments: [{ kind: "question", id: "x", body: "b" }] })),
    );

    expect((await client().list())[0]?.author).toBe("Anonymous");
  });

  it("surfaces an error the store reports", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Sheet not found" })));
    await expect(client().list()).rejects.toThrow("Sheet not found");
  });

  it("explains an HTML response instead of leaking a JSON parse error", async () => {
    // The realistic failure: an Apps Script deployed with the wrong access setting serves a
    // Google sign-in page as HTTP 200 HTML. "Unexpected token <" would help nobody diagnose that.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>Sign in to continue</html>", { status: 200 })),
    );
    await expect(client().list()).rejects.toThrow(/non-JSON response/);
  });
});

describe("post", () => {
  it("sends a CORS simple request so Apps Script never sees a preflight", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        comment: { ...draft, timestamp: "2026-08-01T00:00:00.000Z" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client().post(draft, { passphrase: "secret", honeypot: "" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    // Apps Script does not answer OPTIONS. Anything other than a simple-request content type
    // triggers a preflight the browser will fail before the request is ever sent.
    expect(init.headers).toEqual({ "Content-Type": "text/plain;charset=utf-8" });

    // The body is always a JSON string here; narrow it rather than stringifying a BodyInit union.
    expect(typeof init.body).toBe("string");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: "question", id: "income", passphrase: "secret" });
  });

  it("rejects an over-long body before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      client().post({ ...draft, body: "x".repeat(2001) }, { passphrase: "s", honeypot: "" }),
    ).rejects.toThrow(/too long/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a rejected passphrase as the store's own message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Incorrect passphrase." }, 403)),
    );

    await expect(client().post(draft, { passphrase: "wrong", honeypot: "" })).rejects.toThrow(
      "Incorrect passphrase.",
    );
  });
});
