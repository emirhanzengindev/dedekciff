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
  fictional: z.boolean(),
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
  fictional: z.boolean(),
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
  timestamp: z.string().refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ||
      /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value),
    { message: "timestamp must be an ISO datetime with offset or a YYYY[-MM[-DD]] date" }
  ),
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

export const caseIntentPatternSchema = z
  .object({
    intent: z.string().min(1),
    pattern: z.string().min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      // eslint-disable-next-line no-new
      new RegExp(value.pattern, "u");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `intentPatterns["${value.intent}"].pattern is not a valid unicode regular expression`
      });
    }
  });

export const caseTopicAliasSchema = z
  .object({
    characterId: z.string().min(1).optional(),
    intent: z.string().min(1).optional(),
    intentPrefix: z.string().min(1).optional(),
    topic: z.string().min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.intent && !value.intentPrefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "topicAliases entries must define intent or intentPrefix"
      });
    }
  });

export const caseInterrogationRulesSchema = z
  .object({
    minimumDurationMs: z.number().int().min(0),
    requiredTopics: z.array(z.string().min(1)),
    minimumCompletedTopics: z.number().int().min(0),
    completionEvidenceIds: z.array(z.string().min(1)),
    repeatedQuestionCount: z.number().int().min(1),
    corroboratingInterview: z
      .object({ characterId: z.string().min(1), topic: z.string().min(1) })
      .strict()
      .nullable()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.minimumCompletedTopics > value.requiredTopics.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "interrogation.minimumCompletedTopics cannot exceed requiredTopics.length"
      });
    }
  });

export const caseStrengthWeakAreaSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    missingEvidenceIds: z.array(z.string().min(1)).min(1).optional(),
    requiresIndependentVerification: z.boolean().optional()
  })
  .strict();

export const prosecutionComponentEvaluationSchema: z.ZodType<unknown> = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("suspect_and_any_evidence"),
      evidenceIds: z.array(z.string().min(1)).min(1),
      points: z.number().int().min(0)
    })
    .strict(),
  z
    .object({
      kind: z.literal("evidence_tiers"),
      tiers: z
        .array(
          z
            .object({
              match: z.enum(["all", "any"]),
              evidenceIds: z.array(z.string().min(1)).min(1),
              points: z.number().int().min(0)
            })
            .strict()
        )
        .min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal("evidence_with_analysis"),
      match: z.enum(["all", "any"]),
      evidenceIds: z.array(z.string().min(1)).min(1),
      pointsWithAnalysis: z.number().int().min(0),
      points: z.number().int().min(0)
    })
    .strict(),
  z
    .object({
      kind: z.literal("independent_or_fallback"),
      points: z.number().int().min(0),
      fallback: z
        .object({
          minEvidenceCount: z.number().int().min(0),
          requiresAnalysis: z.boolean(),
          points: z.number().int().min(0)
        })
        .strict()
    })
    .strict(),
  z
    .object({ kind: z.literal("analysis_present"), points: z.number().int().min(0) })
    .strict()
]);

export const prosecutionComponentConfigSchema = z
  .object({
    id: z.string().min(1),
    evaluation: prosecutionComponentEvaluationSchema
  })
  .strict();

export const caseFallbackTextsSchema = z
  .object({
    unknown: z.string().min(1),
    locked: z.string().min(1),
    requiresInvestigation: z.string().min(1)
  })
  .strict();

export const caseRulesSchema = z
  .object({
    suspectCharacterId: z.string().min(1),
    prosecutorCharacterId: z.string().min(1).nullable(),
    interrogation: caseInterrogationRulesSchema,
    characterEvidenceScope: z.record(
      z.union([z.array(z.string().min(1)), z.literal("*")])
    ),
    caseStrength: z
      .object({ weakAreas: z.array(caseStrengthWeakAreaSchema).min(1) })
      .strict(),
    prosecution: z
      .object({
        readinessEvidenceIds: z.array(z.string().min(1)),
        components: z.array(prosecutionComponentConfigSchema).min(1)
      })
      .strict(),
    topicAliases: z.array(caseTopicAliasSchema),
    intentPatterns: z.array(caseIntentPatternSchema).min(1),
    recordQuestionsWithoutTopic: z.boolean(),
    narrativeStyle: z.enum(["case_001_dialogue", "evidence_matching"]),
    fallbackTexts: caseFallbackTextsSchema,
    contentWarnings: z.array(z.string().min(1))
  })
  .strict();

export type PlayerActionInput = z.infer<typeof playerActionSchema>;
export type ProsecutionSubmissionInput = z.infer<typeof prosecutionSubmissionSchema>;
