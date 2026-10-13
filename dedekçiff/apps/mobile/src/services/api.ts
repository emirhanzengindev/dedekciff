import { supabase } from "./supabase";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export const DEFAULT_CASE_ID = "case-001";

export interface CaseSummaryDto {
  caseId: string;
  title: string;
  contentWarnings: string[];
}

export interface CaseDetailDto extends CaseSummaryDto {
  initialLocationIds: string[];
  suspectCharacterId: string;
}

export interface SessionDto {
  id: string;
  caseId: string;
  caseTitle: string;
  suspectCharacterId: string;
  contentWarnings: string[];
  unlockedEvidenceIds: string[];
  evidenceCount: number;
  completedInterviews: Array<{ characterId: string; topic?: string }>;
  characters: Array<{ id: string; name: string; role: string; initialStatement: string }>;
  locations: Array<{ id: string; name: string; description: string; icon: string }>;
  interrogations: Array<{ characterId: string; startedAt: string; questionTopics: string[] }>;
}

export async function listCases(): Promise<CaseSummaryDto[]> {
  return request("/api/cases");
}

export async function getCase(caseId: string): Promise<CaseDetailDto> {
  return request(`/api/cases/${encodeURIComponent(caseId)}`);
}

export async function createSession(caseId: string = DEFAULT_CASE_ID): Promise<SessionDto> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ caseId })
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
