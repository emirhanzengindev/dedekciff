export type Id = string;

export interface UnlockCondition {
  evidenceIds?: Id[] | undefined;
  characterId?: Id | undefined;
  interviewCompleted?: Id | undefined;
  questionTopic?: string | undefined;
  action?: string | undefined;
  event?: string | undefined;
}

export interface CaseEvidence {
  id: Id;
  name: string;
  type: string;
  fictional: boolean;
  locationId: Id;
  initiallyAvailable: boolean;
  unlockCondition: UnlockCondition | null;
  facts: string[];
  factCodes?: string[] | undefined;
  reliability: number;
  independentVerification: boolean;
  unlocks: {
    characters?: Id[] | undefined;
    locations?: Id[] | undefined;
    evidence?: Id[] | undefined;
  };
  limitations: string[];
  sourceBoundary: string;
  unlockConditionServerEvaluated: boolean;
  clientMaySetUnlocked: boolean;
  proves: string[];
  doesNotProve: string[];
}

export interface CaseCharacter {
  id: Id;
  name: string;
  role: string;
  fictional: boolean;
  initiallyAvailable: boolean;
  unlockCondition: UnlockCondition | null;
  knows: string[];
  doesNotKnow?: string[] | undefined;
  initialStatement?: string | undefined;
  truthPolicy: string;
  topicAnswers?: Record<string, string> | undefined;
  knowledgePolicy: unknown;
  availableWhen: string;
}

export interface CaseLocation {
  id: Id;
  name: string;
  type: string;
  initiallyVisible: boolean;
  accessible: boolean;
  unlockCondition: UnlockCondition | null;
  icon: string;
  description: string;
}

export interface TimelineEntry {
  id: Id;
  timestamp: string;
  event: string;
  sourceEvidenceIds: Id[];
  status: string;
  certainty: string;
  note: string;
}

export interface CaseData {
  caseId: Id;
  title: string;
  rules: CaseRules;
  characters: CaseCharacter[];
  evidence: CaseEvidence[];
  locations: CaseLocation[];
  timeline: TimelineEntry[];
  prosecution: ProsecutionRules;
}

export interface SessionState {
  id: Id;
  caseId: Id;
  userId: Id;
  unlockedEvidenceIds: Id[];
  completedInterviews: Array<{ characterId: Id; topic?: string }>;
  interrogations: Array<{ characterId: Id; startedAt: string; questionTopics: string[] }>;
  questionHistory: Array<{ characterId: Id; question: string; topic: string; askedAt: string }>;
  actions: string[];
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export type PlayerAction =
  | { type: "load_case" }
  | { type: "visit_location"; locationId: Id }
  | { type: "start_interview"; characterId: Id }
  | { type: "complete_interview"; characterId: Id; topic?: string | undefined }
  | { type: "ask_character"; characterId: Id; question: string; topic?: string | undefined }
  | { type: "search_similar_complaints" }
  | { type: "request_object_examination" }
  | { type: "inspect_phone_messages" }
  | { type: "compare_victim_statements" }
  | { type: "interview_suspect" }
  | { type: "cross_check_payment_claim" }
  | { type: "client_request_unlock"; evidenceId: Id };

export interface UnlockResult {
  status: "applied" | "denied";
  session: SessionState;
  newlyUnlockedEvidenceIds: Id[];
  reason?: string;
}

export interface CharacterReply {
  status: "answered" | "unknown" | "locked" | "requires_investigation";
  answer: string;
  supportingEvidenceIds: Id[];
  newlyUnlockedEvidenceIds: Id[];
  confidence: number;
}

export interface ProsecutionRules {
  availableAtAnyTime: boolean;
  scoring: {
    maxScore: number;
    components: Array<{ id: string; name: string; max: number; rule: string }>;
  };
  outcomes: Array<{
    id: "accepted_for_further_action" | "returned_for_more_evidence" | "rejected";
    minScore: number;
  maxScore?: number | undefined;
    conditions: string[];
    description: string;
  }>;
}

export interface ProsecutionSubmission {
  suspectId: Id;
  crimeSummary: string;
  motive?: string | undefined;
  timelineSummary?: string | undefined;
  evidenceIds: Id[];
  contradictionAnalysis?: string | undefined;
  gaps?: string | undefined;
}

export interface ProsecutionDecision {
  id: Id;
  outcome: "accepted_for_further_action" | "returned_for_more_evidence" | "rejected";
  score: number;
  reasons: string[];
  componentScores: Record<string, number>;
  createdAt: string;
}

export interface CaseTopicAlias {
  characterId?: Id | undefined;
  intent?: string | undefined;
  intentPrefix?: string | undefined;
  topic: string;
}

export interface CaseIntentPattern {
  intent: string;
  pattern: string;
}

export interface CaseInterrogationRules {
  minimumDurationMs: number;
  requiredTopics: string[];
  minimumCompletedTopics: number;
  completionEvidenceIds: Id[];
  repeatedQuestionCount: number;
  corroboratingInterview: { characterId: Id; topic: string } | null;
}

export interface CaseStrengthWeakArea {
  id: string;
  text: string;
  missingEvidenceIds?: Id[] | undefined;
  requiresIndependentVerification?: boolean | undefined;
}

export type ProsecutionComponentEvaluation =
  | { kind: "suspect_and_any_evidence"; evidenceIds: Id[]; points: number }
  | { kind: "evidence_tiers"; tiers: Array<{ match: "all" | "any"; evidenceIds: Id[]; points: number }> }
  | { kind: "evidence_with_analysis"; match: "all" | "any"; evidenceIds: Id[]; pointsWithAnalysis: number; points: number }
  | { kind: "independent_or_fallback"; points: number; fallback: { minEvidenceCount: number; requiresAnalysis: boolean; points: number } }
  | { kind: "analysis_present"; points: number };

export interface ProsecutionComponentConfig {
  id: string;
  evaluation: ProsecutionComponentEvaluation;
}

export interface CaseFallbackTexts {
  unknown: string;
  locked: string;
  requiresInvestigation: string;
}

export interface CaseRules {
  suspectCharacterId: Id;
  prosecutorCharacterId: Id | null;
  interrogation: CaseInterrogationRules;
  characterEvidenceScope: Record<Id, Id[] | "*">;
  caseStrength: { weakAreas: CaseStrengthWeakArea[] };
  prosecution: { readinessEvidenceIds: Id[]; components: ProsecutionComponentConfig[] };
  topicAliases: CaseTopicAlias[];
  intentPatterns: CaseIntentPattern[];
  recordQuestionsWithoutTopic: boolean;
  narrativeStyle: "case_001_dialogue" | "evidence_matching";
  fallbackTexts: CaseFallbackTexts;
  contentWarnings: string[];
}
