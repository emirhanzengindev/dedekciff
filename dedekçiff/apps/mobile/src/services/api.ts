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
  visitedLocationIds?: string[];
  examinedLocationIds?: string[];
  interrogations: Array<{ characterId: string; startedAt: string; questionTopics: string[] }>;
}

export enum RequestErrorType {
  Network = "Network",
  ServerTimeout = "ServerTimeout",
  ServerError = "ServerError",
  NotAuthorized = "NotAuthorized",
  Unauthorized = "Unauthorized",
  Forbidden = "Forbidden",
  NotFound = "NotFound",
  Conflict = "Conflict",
  Unprocessable = "Unprocessable",
  Unknown = "Unknown",
}

interface RequestError extends Error {
  type: RequestErrorType;
  status?: number;
  retryable: boolean;
  body?: unknown;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 6000;

function isRequestError(error: unknown): error is RequestError {
  return error instanceof Error && error.name === "RequestError";
}

export function isRetryableError(error: unknown): boolean {
  return isRequestError(error) ? error.retryable : false;
}

function createRequestError(
  type: RequestErrorType,
  message: string,
  retryable: boolean,
  status?: number,
  body?: unknown
): RequestError {
  const error = new Error(message) as RequestError;
  error.name = "RequestError";
  error.type = type;
  error.retryable = retryable;
  if (status !== undefined) error.status = status;
  if (body !== undefined) error.body = body;
  return error;
}

function statusToType(status: number): RequestErrorType {
  if (status === 401 || status === 403) return RequestErrorType.Unauthorized;
  if (status === 404) return RequestErrorType.NotFound;
  if (status >= 500) return RequestErrorType.ServerError;
  return RequestErrorType.Unknown;
}

function isJsonError(value: unknown): value is { error?: string; message?: string; details?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("error" in value || "message" in value || "details" in value)
  );
}

function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function isAbortError(error: unknown): boolean {
  return typeof (error as Error).name === "string" && /abort|Canceled/i.test((error as Error).name);
}

export async function listCases(): Promise<CaseSummaryDto[]> {
  return request<CaseSummaryDto[]>("/api/cases");
}

export async function getCase(caseId: string): Promise<CaseDetailDto> {
  return request<CaseDetailDto>(`/api/cases/${encodeURIComponent(caseId)}`);
}

export async function createSession(caseId: string = DEFAULT_CASE_ID): Promise<SessionDto> {
  return request<SessionDto>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ caseId })
  });
}

export async function getSession(sessionId: string): Promise<SessionDto> {
  return request<SessionDto>(`/api/sessions/${sessionId}`);
}

export async function sendInteraction(
  sessionId: string,
  payload: unknown
): Promise<{ status: "applied"; newlyUnlockedEvidenceIds: string[]; session: SessionDto }> {
  return request<{ status: "applied"; newlyUnlockedEvidenceIds: string[]; session: SessionDto }>(`/api/sessions/${sessionId}/interactions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export interface EvidenceItemDto {
  id: string;
  name: string;
  facts: string[];
  limitations?: string[];
}

export interface AskQuestionResultDto {
  answer: string;
  status: string;
  supportingEvidenceIds: string[];
  newlyUnlockedEvidenceIds: string[];
  session: SessionDto;
}

export interface ProsecutionResultDto {
  outcome: string;
  score: number;
  reasons: string[];
}

export async function askQuestion(
  sessionId: string,
  payload: { characterId: string; question: string; topic?: string }
): Promise<AskQuestionResultDto> {
  return request<AskQuestionResultDto>(`/api/sessions/${sessionId}/questions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getEvidence(sessionId: string): Promise<{ evidence: EvidenceItemDto[] }> {
  return request<{ evidence: EvidenceItemDto[] }>(`/api/sessions/${sessionId}/evidence`);
}

export async function getCaseStrength(sessionId: string): Promise<{ score: number; weakAreas: string[] }> {
  return request<{ score: number; weakAreas: string[] }>(`/api/sessions/${sessionId}/case-strength`);
}

export async function submitProsecution(sessionId: string, payload: unknown): Promise<ProsecutionResultDto> {
  return request<ProsecutionResultDto>(`/api/sessions/${sessionId}/prosecution-submissions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function buildHeaders(init: RequestInit): Promise<Headers> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  if (data.session?.access_token) {
    headers.set("authorization", `Bearer ${data.session.access_token}`);
  }
  return headers;
}

async function requestOnce(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const headers = await buildHeaders(init);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    const body = await readJson(response);

    if (!response.ok) {
      const errorBody = isJsonError(body) ? body : null;
      const message = errorBody?.error ?? errorBody?.message ?? `HTTP ${response.status}`;
      const retryable = response.status === 500 || response.status === 502 || response.status === 504;
      throw createRequestError(statusToType(response.status), message, retryable, response.status, errorBody ?? undefined);
    }

    return body;
  } catch (error) {
    if (isRequestError(error)) throw error;
    if (isAbortError(error)) {
      throw createRequestError(RequestErrorType.ServerTimeout, "Request timed out", true);
    }
    throw createRequestError(RequestErrorType.Network, "Network request failed", true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  return (await requestOnce(path, init)) as T;
}
