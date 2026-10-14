import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  answerCharacterQuestion,
  applyPlayerAction,
  calculateCaseStrength,
  classifyQuestionIntent,
  createSession,
  DEFAULT_CASE_ID,
  evaluateProsecutionSubmission,
  findRepoRoot,
  getAccessibleCharacters,
  getAccessibleEvidence,
  getTimeline,
  getVisibleLocations,
  isSupportedCaseId,
  listCases,
  loadCaseData,
  publicCaseSummary,
  resolveQuestionTopic,
  validateCaseIntegrity
} from "@case-001/case-engine";
import type { ProsecutionDecision, SessionState, CaseData } from "@case-001/shared";
import { playerActionSchema, prosecutionSubmissionSchema } from "@case-001/validation";
import { createSessionStore, type SessionStore } from "./sessionRepository.js";
import { z } from "zod";

interface ApiState {
  sessions: Map<string, SessionState>;
  decisions: Map<string, ProsecutionDecision>;
}

type UserResolver = (request: FastifyRequest) => Promise<string | null | undefined>;

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

const paramsSchema = z.object({ sessionId: z.string() });
const submissionParamsSchema = z.object({ sessionId: z.string(), submissionId: z.string() });
const questionSchema = z.object({
  characterId: z.string(),
  question: z.string().min(1).max(800),
  topic: z.string().optional()
});

export async function buildApp(
  state: ApiState = { sessions: new Map(), decisions: new Map() },
  resolveUserId: UserResolver = resolveAuthenticatedUser,
  sessionStore: SessionStore = createSessionStore(state.sessions, state.decisions)
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 32 * 1024
  });
  app.decorateRequest("userId", null);
  const repoRoot = findRepoRoot();
  const supportedCaseIds = listCases(repoRoot);
  const caseRegistry = new Map<string, CaseData>();
  for (const caseId of supportedCaseIds) {
    caseRegistry.set(caseId, loadCaseData(caseId, repoRoot));
  }
  const defaultCaseId = caseRegistry.has(DEFAULT_CASE_ID) && supportedCaseIds.length > 0
    ? DEFAULT_CASE_ID
    : (supportedCaseIds[0] ?? DEFAULT_CASE_ID);
  const defaultCaseData = caseRegistry.get(defaultCaseId);
  if (!defaultCaseData) {
    throw new Error("NO_SUPPORTED_CASE_PACKS");
  }
  const caseIntegrities = new Map<string, ReturnType<typeof validateCaseIntegrity>>();
  for (const [caseId, caseData] of caseRegistry) {
    caseIntegrities.set(caseId, validateCaseIntegrity(caseData));
  }

  function caseForSession(session: { caseId: string }): CaseData | undefined {
    return caseRegistry.get(session.caseId);
  }

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "Case-001 API", version: "0.1.0" }
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?", 1)[0];
    if (path !== "/api/sessions" && !path?.startsWith("/api/sessions/")) return;

    const userId = await resolveUserId(request);
    if (userId === undefined) return reply.code(503).send({ error: "auth_not_configured" });
    if (userId === null) return reply.code(401).send({ error: "unauthorized" });
    request.userId = userId;
  });

  app.get("/health", async () => ({
    ok: [...caseIntegrities.values()].every((report) => report.errors.length === 0),
    caseId: defaultCaseId,
    supportedCaseIds,
    integrity: caseIntegrities.get(defaultCaseId)
  }));

  app.get("/api/cases", async () => [...caseRegistry.values()].map(publicCaseSummary));

  app.get("/api/cases/:caseId", async (request, reply) => {
    const params = z.object({ caseId: z.string() }).parse(request.params);
    const requestedCase = caseRegistry.get(params.caseId);
    if (!requestedCase) return reply.code(404).send({ error: "case_not_found" });
    return {
      ...publicCaseSummary(requestedCase),
      initialLocationIds: getVisibleLocations(requestedCase, createSession(requestedCase, "public")).map(
        (location) => location.id
      ),
      suspectCharacterId: requestedCase.rules.suspectCharacterId,
      contentWarnings: requestedCase.rules.contentWarnings
    };
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = z.object({ caseId: z.string().optional() }).parse(request.body ?? {});
    const caseId = body.caseId ?? DEFAULT_CASE_ID;
    if (!isSupportedCaseId(caseId, repoRoot)) return reply.code(404).send({ error: "case_not_found" });
    const requestedCase = caseRegistry.get(caseId);
    if (!requestedCase) return reply.code(404).send({ error: "case_not_found" });
    const session = createSession(requestedCase, request.userId ?? "");
    await sessionStore.saveSession(session);
    return reply.code(201).send(serializeSession(requestedCase, session));
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const sessionId = params.sessionId;
    const userId = request.userId ?? "";

    const session = await sessionStore.getSession(sessionId, userId);
    if (!session) {
      return reply.code(404).send({ error: "session_not_found", details: { sessionId } });
    }

    const caseData = caseForSession(session);
    if (!caseData) {
      return reply.code(404).send({ error: "case_not_found", details: { sessionId } });
    }

    return serializeSession(caseData, session);
  });

  app.get("/api/sessions/:sessionId/map", async (request, reply) => {
    const session = await sessionStore.getSession(paramsSchema.parse(request.params).sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    return { locations: getVisibleLocations(caseData, session) };
  });

  app.post("/api/sessions/:sessionId/interactions", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const session = await sessionStore.getSession(params.sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    const action = playerActionSchema.parse(request.body);
    const result = applyPlayerAction(caseData, session, action);
    await sessionStore.saveSession(result.session);
    if (result.status === "denied") return reply.code(403).send({ error: result.reason, session: serializeSession(caseData, result.session) });
    return { ...result, session: serializeSession(caseData, result.session) };
  });

  app.get("/api/sessions/:sessionId/evidence", async (request, reply) => {
    const session = await sessionStore.getSession(paramsSchema.parse(request.params).sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    return { evidence: getAccessibleEvidence(caseData, session) };
  });

  app.post("/api/sessions/:sessionId/questions", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const session = await sessionStore.getSession(params.sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    const body = questionSchema.parse(request.body);
    const questionTopic = classifyQuestionIntent(caseData, body.question);
    if (!questionTopic && !caseData.rules.recordQuestionsWithoutTopic) {
      const answer = answerCharacterQuestion(caseData, session, body.characterId, body.question);
      return { ...answer, newlyUnlockedEvidenceIds: [], session: serializeSession(caseData, session) };
    }
    const trustedTopic = resolveQuestionTopic(caseData, body.characterId, questionTopic);
    let actionResult = applyPlayerAction(caseData, session, {
      type: "ask_character",
      characterId: body.characterId,
      question: body.question,
      topic: trustedTopic
    });
    if (actionResult.status === "denied") {
      return reply.code(403).send({ error: actionResult.reason ?? "question_not_available" });
    }
    if (body.characterId === caseData.rules.suspectCharacterId) {
      const normalizedQuestion = body.question.toLocaleLowerCase("tr-TR").replace(/[?!.,]/gu, "").trim();
      const interrogationRules = caseData.rules.interrogation;
      const repeated = actionResult.session.questionHistory.filter(
        (entry: { characterId: string; question: string }) => entry.characterId === caseData.rules.suspectCharacterId && entry.question === normalizedQuestion
      ).length >= interrogationRules.repeatedQuestionCount;
      const corroboration = interrogationRules.corroboratingInterview;
      const corroborated = corroboration !== null && actionResult.session.completedInterviews.some(
        (interview: { characterId: string; topic?: string }) => interview.characterId === corroboration.characterId && interview.topic === corroboration.topic
      );
      const interrogation = actionResult.session.interrogations.find((item: { characterId: string }) => item.characterId === caseData.rules.suspectCharacterId);
      const evidenceReady = interrogationRules.completionEvidenceIds.every((id: string) => actionResult.session.unlockedEvidenceIds.includes(id));
      const requiredTopics = new Set(interrogationRules.requiredTopics);
      const completedTopics = requiredTopics.size === 0
        ? (interrogation?.questionTopics.length ?? 0)
        : (interrogation?.questionTopics.filter((topic: string) => requiredTopics.has(topic)).length ?? 0);
      if (repeated && corroborated && interrogation && completedTopics >= interrogationRules.minimumCompletedTopics && evidenceReady) {
        const completion = applyPlayerAction(caseData, actionResult.session, { type: "interview_suspect" });
        if (completion.status === "applied") actionResult = completion;
      }
    }
    await sessionStore.saveSession(actionResult.session);
    const answer = answerCharacterQuestion(caseData, actionResult.session, body.characterId, body.question);
    return {
      ...answer,
      newlyUnlockedEvidenceIds: actionResult.newlyUnlockedEvidenceIds,
      session: serializeSession(caseData, actionResult.session)
    };
  });

  app.get("/api/sessions/:sessionId/timeline", async (request, reply) => {
    const session = await sessionStore.getSession(paramsSchema.parse(request.params).sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    return { timeline: getTimeline(caseData, session) };
  });

  app.get("/api/sessions/:sessionId/contradictions", async (request, reply) => {
    const session = await sessionStore.getSession(paramsSchema.parse(request.params).sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    return {
      contradictions: calculateCaseStrength(caseData, session).weakAreas.map((text, index) => ({
        id: `CON-${index + 1}`,
        text
      }))
    };
  });

  app.get("/api/sessions/:sessionId/case-strength", async (request, reply) => {
    const session = await sessionStore.getSession(paramsSchema.parse(request.params).sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    return calculateCaseStrength(caseData, session);
  });

  app.post("/api/sessions/:sessionId/prosecution-submissions", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const session = await sessionStore.getSession(params.sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const caseData = caseForSession(session);
    if (!caseData) return reply.code(404).send({ error: "case_not_found" });
    const submission = prosecutionSubmissionSchema.parse(request.body);
    const decision = evaluateProsecutionSubmission(caseData, session, submission);
    await sessionStore.saveSubmission(params.sessionId, session.userId, submission, decision);
    return reply.code(201).send(decision);
  });

  app.get("/api/sessions/:sessionId/prosecution-submissions/:submissionId", async (request, reply) => {
    const params = submissionParamsSchema.parse(request.params);
    const session = await sessionStore.getSession(params.sessionId, request.userId ?? "");
    if (!session) return reply.code(404).send({ error: "session_not_found" });
    const decision = await sessionStore.getSubmission(params.submissionId, params.sessionId, session.userId);
    if (!decision) return reply.code(404).send({ error: "submission_not_found" });
    return decision;
  });

  return app;
}

function serializeSession(caseData: CaseData, session: SessionState) {
  return {
    id: session.id,
    caseId: session.caseId,
    caseTitle: caseData.title,
    suspectCharacterId: caseData.rules.suspectCharacterId,
    contentWarnings: caseData.rules.contentWarnings,
    unlockedEvidenceIds: session.unlockedEvidenceIds,
    completedInterviews: session.completedInterviews,
    evidenceCount: getAccessibleEvidence(caseData, session).length,
    characters: getAccessibleCharacters(caseData, session).map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      initialStatement: character.initialStatement ?? "Bu kişi yalnızca erişilebilir dosya kapsamı içinde yanıt verir."
    })),
    locations: getVisibleLocations(caseData, session).map((location) => ({
      id: location.id,
      name: location.name,
      description: location.description,
      icon: location.icon
    })),
    visitedLocationIds: session.actions
      .filter((action) => action.startsWith("visited:"))
      .map((action) => action.slice("visited:".length)),
    examinedLocationIds: session.actions
      .filter((action) => action.startsWith("examined:"))
      .map((action) => action.slice("examined:".length)),
    interrogations: session.interrogations,
    updatedAt: session.updatedAt
  };
}

async function resolveAuthenticatedUser(request: FastifyRequest): Promise<string | null | undefined> {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV === "production") return undefined;
    return token ? null : "demo-user";
  }
  if (!token) return null;

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const user = z.object({ id: z.string().min(1) }).safeParse(await response.json());
    return user.success ? user.data.id : null;
  } catch {
    return null;
  }
}

