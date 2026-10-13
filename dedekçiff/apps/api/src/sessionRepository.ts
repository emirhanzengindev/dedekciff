import type { ProsecutionDecision, ProsecutionSubmission, SessionState } from "@case-001/shared";
import { z } from "zod";

export interface SessionStore {
  getSession(sessionId: string, userId: string): Promise<SessionState | undefined>;
  saveSession(session: SessionState): Promise<void>;
  getSubmission(submissionId: string, sessionId: string, userId: string): Promise<ProsecutionDecision | undefined>;
  saveSubmission(
    sessionId: string,
    userId: string,
    submission: ProsecutionSubmission,
    decision: ProsecutionDecision
  ): Promise<void>;
}

const sessionSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  userId: z.string(),
  unlockedEvidenceIds: z.array(z.string()),
  completedInterviews: z.array(z.object({ characterId: z.string(), topic: z.string().optional() })),
  interrogations: z.array(z.object({ characterId: z.string(), startedAt: z.string(), questionTopics: z.array(z.string()) })).optional(),
  questionHistory: z.array(z.object({ characterId: z.string(), question: z.string(), topic: z.string(), askedAt: z.string() })).optional(),
  actions: z.array(z.string()),
  notes: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string()
});

const decisionSchema = z.object({
  id: z.string(),
  outcome: z.enum(["accepted_for_further_action", "returned_for_more_evidence", "rejected"]),
  score: z.number(),
  reasons: z.array(z.string()),
  componentScores: z.record(z.number()),
  createdAt: z.string()
});

export class InMemorySessionStore implements SessionStore {
  private readonly submissionOwners = new Map<string, { sessionId: string; userId: string }>();

  constructor(
    private readonly sessions = new Map<string, SessionState>(),
    private readonly submissions = new Map<string, ProsecutionDecision>()
  ) {}

  async getSession(sessionId: string, userId: string) {
    const session = this.sessions.get(sessionId);
    return session?.userId === userId ? session : undefined;
  }

  async saveSession(session: SessionState) {
    this.sessions.set(session.id, session);
  }

  async getSubmission(submissionId: string, sessionId: string, userId: string) {
    const owner = this.submissionOwners.get(submissionId);
    return owner?.sessionId === sessionId && owner.userId === userId ? this.submissions.get(submissionId) : undefined;
  }

  async saveSubmission(
    sessionId: string,
    userId: string,
    _submission: ProsecutionSubmission,
    decision: ProsecutionDecision
  ) {
    this.submissions.set(decision.id, decision);
    this.submissionOwners.set(decision.id, { sessionId, userId });
  }
}

export class SupabaseSessionStore implements SessionStore {
  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly request: typeof fetch = fetch
  ) {}

  async getSession(sessionId: string, userId: string) {
    const url = this.endpoint("game_sessions");
    url.searchParams.set("select", "session_state");
    url.searchParams.set("id", `eq.${sessionId}`);
    url.searchParams.set("user_id", `eq.${userId}`);
    const response = await this.request(url, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("session_storage_unavailable");
    const rows = z.array(z.object({ session_state: sessionSchema })).safeParse(await response.json());
    const stored = rows.success ? rows.data[0]?.session_state : undefined;
    return stored ? {
      ...stored,
      interrogations: stored.interrogations ?? [],
      questionHistory: stored.questionHistory ?? []
    } as SessionState : undefined;
  }

  async saveSession(session: SessionState) {
    const url = this.endpoint("game_sessions");
    url.searchParams.set("on_conflict", "id");
    const response = await this.request(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        id: session.id,
        user_id: session.userId,
        case_id: session.caseId,
        case_version: "1.0.0",
        unlocked_evidence_ids: session.unlockedEvidenceIds,
        completed_interviews: session.completedInterviews,
        actions: session.actions,
        notes: session.notes,
        status: "active",
        updated_at: session.updatedAt,
        session_state: session
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("session_storage_unavailable");
  }

  async getSubmission(submissionId: string, sessionId: string, userId: string) {
    const url = this.endpoint("prosecution_submissions");
    url.searchParams.set("select", "decision");
    url.searchParams.set("id", `eq.${submissionId}`);
    url.searchParams.set("session_id", `eq.${sessionId}`);
    url.searchParams.set("user_id", `eq.${userId}`);
    const response = await this.request(url, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("session_storage_unavailable");
    const rows = z.array(z.object({ decision: decisionSchema })).safeParse(await response.json());
    return rows.success && rows.data.length > 0 ? rows.data[0]?.decision : undefined;
  }

  async saveSubmission(
    sessionId: string,
    userId: string,
    submission: ProsecutionSubmission,
    decision: ProsecutionDecision
  ) {
    const response = await this.request(this.endpoint("prosecution_submissions"), {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({
        id: decision.id,
        session_id: sessionId,
        user_id: userId,
        submission,
        decision
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("session_storage_unavailable");
  }

  private endpoint(table: string) {
    return new URL(`/rest/v1/${table}`, this.supabaseUrl);
  }

  private headers() {
    return { apikey: this.serviceRoleKey, authorization: `Bearer ${this.serviceRoleKey}` };
  }
}

export function createSessionStore(
  sessions: Map<string, SessionState>,
  submissions: Map<string, ProsecutionDecision>
): SessionStore {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey) return new SupabaseSessionStore(supabaseUrl, serviceRoleKey);
  if (process.env.NODE_ENV === "production") throw new Error("SUPABASE_SESSION_STORAGE_NOT_CONFIGURED");
  return new InMemorySessionStore(sessions, submissions);
}