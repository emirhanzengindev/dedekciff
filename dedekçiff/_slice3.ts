        interrogations = [...interrogations, { characterId: action.characterId, startedAt: new Date().toISOString(), questionTopics: [] }];
      }
      break;
    case "complete_interview":
      actions.add(`interview:${action.characterId}:${action.topic ?? ""}`);
      completedInterviews = appendInterview(completedInterviews, action.characterId, action.topic);
      break;
    case "ask_character":
      actions.add(`asked:${action.characterId}:${action.topic ?? ""}`);
      if (action.topic) {
        actions.add(`topic:${action.topic}`);
        completedInterviews = appendInterview(completedInterviews, action.characterId, action.topic);
        if (action.characterId === "C02" && suspectInterrogationTopics.has(action.topic)) {
          interrogations = interrogations.map((interrogation) => interrogation.characterId === "C02"
            ? { ...interrogation, questionTopics: [...new Set([...interrogation.questionTopics, action.topic as string])] }
            : interrogation);
        }
      }
      questionHistory = [...questionHistory, {
        characterId: action.characterId,
        question: normalize(action.question).replace(/[?!.,]/gu, "").trim(),
        topic: action.topic ?? "",
        askedAt: new Date().toISOString()
      }];
      break;
    default:
      actions.add(action.type);
  }
  return { ...session, actions: [...actions], completedInterviews, interrogations, questionHistory };
}

function firstDeniedReason(caseData: CaseData, session: SessionState, action: PlayerAction): string | undefined {
  if (action.type === "visit_location" && !getVisibleLocations(caseData, session).some((location) => location.id === action.locationId)) {
    return "location_locked_or_unknown";
  }
  if (
    (action.type === "ask_character" || action.type === "complete_interview" || action.type === "start_interview") &&
    !getAccessibleCharacters(caseData, session).some((character) => character.id === action.characterId)
  ) {
    return "character_locked_or_unknown";
  }
  if (action.type === "ask_character" && action.characterId === "C02" && !session.interrogations.some((interrogation) => interrogation.characterId === "C02")) {
    return "interrogation_not_started";
  }

  const candidates = caseData.evidence.filter((evidence) => actionMatchesCondition(action, evidence.unlockCondition));
  for (const evidence of candidates) {
    const missing = (evidence.unlockCondition?.evidenceIds ?? []).filter(
      (evidenceId) => !session.unlockedEvidenceIds.includes(evidenceId)
    );
    if (missing.length > 0) return `missing_prerequisite_${missing.join("_")}`;
  }
  if (action.type === "interview_suspect") {
    const missing = ["E07", "E08"].filter((id) => !session.unlockedEvidenceIds.includes(id));
    if (missing.length > 0) return `missing_prerequisite_${missing.join("_")}`;
    const interrogation = session.interrogations.find((item) => item.characterId === "C02");
    if (!interrogation) return "interrogation_not_started";
    if (interrogation.questionTopics.filter((topic) => suspectInterrogationTopics.has(topic)).length < 2) return "interrogation_topics_incomplete";
  }
  return undefined;
}

function actionMatchesCondition(action: PlayerAction, condition: UnlockCondition | null): boolean {
  if (!condition) return false;
  if ("action" in action && condition.action === action.type) return true;
  if (condition.action && action.type === condition.action) return true;
  if (action.type === "complete_interview") return condition.interviewCompleted === action.characterId;
  if (action.type === "ask_character") return condition.characterId === action.characterId;
  return false;
}

function applyInitialUnlocks(caseData: CaseData, session: SessionState): SessionState {
  return caseData.evidence
    .filter((evidence) => evidence.initiallyAvailable)
    .reduce((next, evidence) => appendUniqueEvidence(next, evidence.id), session);
}

function appendUniqueEvidence(session: SessionState, evidenceId: Id): SessionState {
  if (session.unlockedEvidenceIds.includes(evidenceId)) return session;
  return { ...session, unlockedEvidenceIds: [...session.unlockedEvidenceIds, evidenceId] };
}

function appendInterview(
  interviews: Array<{ characterId: Id; topic?: string }>,
  characterId: Id,
  topic: string | undefined
) {
  if (interviews.some((interview) => interview.characterId === characterId && interview.topic === topic)) {
    return interviews;
  }
  const interview = topic === undefined ? { characterId } : { characterId, topic };
  return [...interviews, interview];
}

function touch(session: SessionState): SessionState {
  return { ...session, updatedAt: new Date().toISOString() };
}

function reply(
  status: CharacterReply["status"],
  answer: string,
  supportingEvidenceIds: Id[],
  confidence: number
): CharacterReply {
  return { status, answer, supportingEvidenceIds, newlyUnlockedEvidenceIds: [], confidence };
}

function normalize(input: string): string {
  return input.toLocaleLowerCase("tr-TR");
}

function accessibleSupportingEvidence(caseData: CaseData, session: SessionState, question: string, characterId: Id): Id[] {
  const unlocked = new Set(session.unlockedEvidenceIds);
  const allowedIds = new Set(characterId === "C05"
    ? caseData.evidence.map((evidence) => evidence.id)
    : characterEvidenceScope[characterId] ?? []);
  return caseData.evidence
    .filter((evidence) => unlocked.has(evidence.id))
    .filter((evidence) => allowedIds.has(evidence.id))
    .filter((evidence) => evidence.facts.some((fact) => normalize(fact).split(" ").some((word) => question.includes(word))))
    .map((evidence) => evidence.id)
    .slice(0, 4);
}

function findQuestionEvidence(characterId: Id, accessibleEvidence: CaseEvidence[], question: string): CaseEvidence | undefined {
  const allowedIds = new Set(characterId === "C05"
    ? accessibleEvidence.map((evidence) => evidence.id)
    : characterEvidenceScope[characterId] ?? []);
  const ignoredWords = new Set([
    "acaba", "bana", "bunu", "biliyor", "diye", "gerçekten", "hangi", "hakkında", "nasıl", "nerede",
    "oldu", "olmuş", "sence", "söyler", "söyle", "şey", "var", "yok", "mi", "mı", "mu", "mü"
  ]);
  const words = normalize(question)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length >= 4 && !ignoredWords.has(word));
  if (words.length === 0) return undefined;

  return accessibleEvidence.find((evidence) => {
    if (!allowedIds.has(evidence.id)) return false;
    const facts = normalize(evidence.facts.join(" ")).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/u);
    return words.some((questionWord) => facts.some((factWord) =>
      factWord === questionWord ||
      (Math.min(factWord.length, questionWord.length) >= 5 &&
        (factWord.startsWith(questionWord.slice(0, 5)) || questionWord.startsWith(factWord.slice(0, 5))))
    ));
  });
}
