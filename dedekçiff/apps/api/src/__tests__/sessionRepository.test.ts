import type { ProsecutionDecision, SessionState } from "@case-001/shared";
import { describe, expect, it, vi } from "vitest";
import { InMemorySessionStore, SupabaseSessionStore } from "../sessionRepository.js";

const session: SessionState = {
  id: "session-1",
  caseId: "case-001",
  userId: "user-1",
  unlockedEvidenceIds: ["E01"],
  completedInterviews: [],
  interrogations: [],
  questionHistory: [],
  actions: [],
  notes: [],
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z"
};

const decision: ProsecutionDecision = {
  id: "submission-1",
  outcome: "returned_for_more_evidence",
  score: 20,
  reasons: ["Ek doğrulama gerekli."],
  componentScores: { S1: 20 },
  createdAt: "2026-10-12T00:00:00.000Z"
};

describe("session repositories", () => {
  it("round-trips validated session state and scopes reads to its owner", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify([{ session_state: session }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const store = new SupabaseSessionStore("https://example.supabase.co", "service-key", fetcher);

    await store.saveSession(session);
    const restored = await store.getSession(session.id, session.userId);

    expect(restored).toEqual(session);
    const readCall = fetcher.mock.calls[1];
    const readUrl = new URL(String(readCall?.[0]));
    expect(readUrl.searchParams.get("user_id")).toBe("eq.user-1");
    expect(new Headers(readCall?.[1]?.headers).get("authorization")).toBe("Bearer service-key");
  });

  it("does not return a submission for a different session owner", async () => {
    const store = new InMemorySessionStore();
    await store.saveSubmission(session.id, session.userId, { suspectId: "C02", crimeSummary: "Test", evidenceIds: [] }, decision);

    await expect(store.getSubmission(decision.id, "another-session", session.userId)).resolves.toBeUndefined();
    await expect(store.getSubmission(decision.id, session.id, "another-user")).resolves.toBeUndefined();
    await expect(store.getSubmission(decision.id, session.id, session.userId)).resolves.toEqual(decision);
  });

  it("filters persisted prosecution decisions by submission, session, and user", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ decision }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const store = new SupabaseSessionStore("https://example.supabase.co", "service-key", fetcher);

    await expect(store.getSubmission(decision.id, session.id, session.userId)).resolves.toEqual(decision);
    const query = new URL(String(fetcher.mock.calls[0]?.[0])).searchParams;
    expect(query.get("id")).toBe("eq.submission-1");
    expect(query.get("session_id")).toBe("eq.session-1");
    expect(query.get("user_id")).toBe("eq.user-1");
  });
});