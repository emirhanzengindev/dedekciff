import { supabase } from "./supabase";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export interface SessionDto {
  id: string;
  unlockedEvidenceIds: string[];
  evidenceCount: number;
  completedInterviews: Array<{ characterId: string; topic?: string }>;
  characters: Array<{ id: string; name: string; role: string; initialStatement: string }>;
  locations: Array<{ id: string; name: string; description: string; icon: string }>;
  interrogations: Array<{ characterId: string; startedAt: string; questionTopics: string[] }>;
}

export async function createSession(): Promise<SessionDto> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ caseId: "case-001" })
  });
}

export async function getSession(sessionId: string): Promise<SessionDto> {
  return request(`/api/sessions/${sessionId}`);
}

export async function sendInteraction(
  sessionId: string,
  payload: unknown
): Promise<{ status: "applied"; newlyUnlockedEvidenceIds: string[]; session: SessionDto }> {
  return request(`/api/sessions/${sessionId}/interactions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function askQuestion(
  sessionId: string,
  payload: { characterId: string; question: string; topic?: string }
) {
  return request(`/api/sessions/${sessionId}/questions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getEvidence(sessionId: string) {
  return request(`/api/sessions/${sessionId}/evidence`);
}

export async function getCaseStrength(sessionId: string) {
  return request(`/api/sessions/${sessionId}/case-strength`);
}

export async function submitProsecution(sessionId: string, payload: unknown) {
  return request(`/api/sessions/${sessionId}/prosecution-submissions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function request(path: string, init: RequestInit = {}) {
  const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (data.session?.access_token) headers.set("authorization", `Bearer ${data.session.access_token}`);

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "api_error");
  return json;
}
