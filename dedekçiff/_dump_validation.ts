import { z } from "zod";

export const unlockConditionSchema = z
  .object({
    evidenceIds: z.array(z.string()).optional(),
    characterId: z.string().optional(),
    interviewCompleted: z.string().optional(),
    questionTopic: z.string().optional(),
    action: z.string().optional(),
    event: z.string().optional()
  })
  .strict();

export const evidenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  fictional: z.literal(true),
  locationId: z.string(),
  initiallyAvailable: z.boolean(),
  unlockCondition: unlockConditionSchema.nullable(),
  facts: z.array(z.string()).min(1),
  factCodes: z.array(z.string()).optional(),
  reliability: z.number().min(0).max(1),
  independentVerification: z.boolean(),
  unlocks: z
    .object({
      characters: z.array(z.string()).optional(),
      locations: z.array(z.string()).optional(),
      evidence: z.array(z.string()).optional()
    })
    .strict(),
  limitations: z.array(z.string()),
  sourceBoundary: z.string(),
  unlockConditionServerEvaluated: z.literal(true),
  clientMaySetUnlocked: z.literal(false),
  proves: z.array(z.string()),
  doesNotProve: z.array(z.string())
});

export const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  fictional: z.literal(true),
  initiallyAvailable: z.boolean(),
  unlockCondition: unlockConditionSchema.nullable(),
  knows: z.array(z.string()),
  doesNotKnow: z.array(z.string()).optional(),
  initialStatement: z.string().optional(),
  truthPolicy: z.string(),
  topicAnswers: z.record(z.string()).optional(),
  knowledgePolicy: z.record(z.unknown()),
  availableWhen: z.string()
});

export const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  initiallyVisible: z.boolean(),
  accessible: z.boolean(),
  unlockCondition: unlockConditionSchema.nullable(),
  icon: z.string(),
  description: z.string()
});

export const timelineEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  event: z.string(),
  sourceEvidenceIds: z.array(z.string()),
  status: z.string(),
  certainty: z.string(),
  note: z.string()
});

export const playerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("load_case") }),
  z.object({ type: z.literal("visit_location"), locationId: z.string() }),
  z.object({ type: z.literal("start_interview"), characterId: z.string() }),
  z.object({
    type: z.literal("complete_interview"),
    characterId: z.string(),
    topic: z.string().optional()
  }),
  z.object({
    type: z.literal("ask_character"),
    characterId: z.string(),
    question: z.string().min(1).max(800),
    topic: z.string().optional()
  }),
  z.object({ type: z.literal("search_similar_complaints") }),
  z.object({ type: z.literal("request_object_examination") }),
  z.object({ type: z.literal("inspect_phone_messages") }),
  z.object({ type: z.literal("compare_victim_statements") }),
  z.object({ type: z.literal("interview_suspect") }),
  z.object({ type: z.literal("cross_check_payment_claim") }),
  z.object({ type: z.literal("client_request_unlock"), evidenceId: z.string() })
]);

export const prosecutionSubmissionSchema = z.object({
  suspectId: z.string(),
  crimeSummary: z.string().min(1).max(2000),
  motive: z.string().max(1000).optional(),
  timelineSummary: z.string().max(2000).optional(),
  evidenceIds: z.array(z.string()).min(0).max(20),
  contradictionAnalysis: z.string().max(2000).optional(),
  gaps: z.string().max(2000).optional()
});

export type PlayerActionInput = z.infer<typeof playerActionSchema>;
export type ProsecutionSubmissionInput = z.infer<typeof prosecutionSubmissionSchema>;
