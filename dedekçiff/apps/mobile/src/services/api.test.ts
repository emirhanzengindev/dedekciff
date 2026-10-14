import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The API layer only needs Supabase for the optional Bearer token. Mock it as
// "not configured" so no expo-secure-store / native modules are pulled in.
vi.mock("./supabase", () => ({ supabase: null }));

import { getSession, isRetryableError, request, createSession, RequestErrorType } from "./api";

type RequestErrorLike = {
  name: string;
  type?: RequestErrorType;
  retryable?: boolean;
  status?: number;
  message?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

async function captureError(promise: Promise<unknown>): Promise<RequestErrorLike> {
  try {
    await promise;
  } catch (error) {
    return error as RequestErrorLike;
  }
  throw new Error("Expected the promise to reject but it resolved.");
}

describe("api request error handling", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the parsed body on success and preserves session data", async () => {
    const session = { id: "s1", caseId: "case-001", unlockedEvidenceIds: ["E01"] };
    fetchMock.mockResolvedValue(jsonResponse(session));
    const result = await getSession("s1");
    expect(result).toEqual(session);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps a network failure to a retryable Network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    const error = await captureError(request("/api/sessions/s1"));
    expect(error.name).toBe("RequestError");
    expect(error.type).toBe(RequestErrorType.Network);
    expect(error.retryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
  });

  it("maps a request timeout to a retryable ServerTimeout error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const promise = request("/api/sessions/s1");
    const assertion = promise.then(
      (value) => ({ ok: false as const, value }),
      (error: RequestErrorLike) => ({ ok: true as const, error })
    );
    await vi.advanceTimersByTimeAsync(6000);
    const result = await assertion;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.error.type).toBe(RequestErrorType.ServerTimeout);
      expect(result.error.retryable).toBe(true);
      expect(isRetryableError(result.error)).toBe(true);
    }
  });

  it("maps 401 to a non-retryable Unauthorized error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    const error = await captureError(request("/api/sessions/s1"));
    expect(error.type).toBe(RequestErrorType.Unauthorized);
    expect(error.retryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
  });

  it("maps 404 (session_not_found) to a non-retryable NotFound error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "session_not_found" }, 404));
    const error = await captureError(getSession("missing"));
    expect(error.type).toBe(RequestErrorType.NotFound);
    expect(error.retryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
  });

  it("maps 503 to a non-retryable error so it is not blind-retried", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "auth_not_configured" }, 503));
    const error = await captureError(request("/api/sessions/s1"));
    expect(error.type).toBe(RequestErrorType.ServerError);
    expect(error.retryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
  });

  it("maps 500 to a retryable ServerError error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "internal_error" }, 500));
    const error = await captureError(request("/api/sessions/s1"));
    expect(error.type).toBe(RequestErrorType.ServerError);
    expect(error.retryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
  });

  it("sends a JSON content-type and no authorization header when Supabase is not configured", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await request("/api/cases");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBeNull();
  });
});

describe("api case-selection flow", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns every case the server reports so both case-001 and case-002 can be listed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { caseId: "case-001", title: "Çil Çil Altınlar", contentWarnings: [] },
        { caseId: "case-002", title: "Reddedilmenin Ölümcül Bedeli", contentWarnings: [] }
      ])
    );
    const { listCases } = await import("./api");
    const cases = await listCases();
    expect(cases.map((entry) => entry.caseId)).toEqual(["case-001", "case-002"]);
  });

  it("posts the selected caseId when starting a session so case-002 does not fall back to case-001", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "s2", caseId: "case-002", unlockedEvidenceIds: ["E01"] }, 201));
    const created = await createSession("case-002");
    expect(created.caseId).toBe("case-002");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/sessions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ caseId: "case-002" });
  });
});
