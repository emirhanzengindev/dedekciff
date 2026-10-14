import type {
  CaseCharacter,
  CaseData,
  CaseEvidence,
  CaseLocation,
  CaseRules,
  CharacterReply,
  Id,
  PlayerAction,
  ProsecutionDecision,
  ProsecutionSubmission,
  SessionState,
  UnlockCondition,
  UnlockResult
} from "@case-001/shared";

type IntentPattern = { intent: string; regex: RegExp };

// Evidence unlocked only by accumulated prerequisites (pure `evidenceIds`
// conditions) advances exclusively through explicit investigation actions.
// Passive actions (visiting a location, chatting, starting an interview)
// record progress but never discover evidence on their own.
const CHAIN_ADVANCE_ACTION_TYPES = new Set<string>([
  "load_case",
  "examine_location",
  "search_similar_complaints",
  "request_object_examination",
  "inspect_phone_messages",
  "compare_victim_statements",
  "interview_suspect",
  "cross_check_payment_claim"
]);

function isManualStepCondition(condition: UnlockCondition | null): boolean {
  if (condition === null) return false;
  return Boolean(
    condition.action ||
    condition.event ||
    condition.characterId ||
    condition.interviewCompleted ||
    condition.questionTopic
  );
}

const intentPatternCache = new WeakMap<CaseData, IntentPattern[]>();

function compiledIntentPatterns(caseData: CaseData): IntentPattern[] {
  const cached = intentPatternCache.get(caseData);
  if (cached) return cached;
  const compiled = caseData.rules.intentPatterns.map((entry) => ({
    intent: entry.intent,
    regex: new RegExp(entry.pattern, "u")
  }));
  intentPatternCache.set(caseData, compiled);
  return compiled;
}

function evidenceScopeAllows(rules: CaseRules, characterId: Id, evidence: CaseEvidence[]): Set<Id> {
  const scope = rules.characterEvidenceScope[characterId];
  if (scope === "*") return new Set(evidence.map((entry) => entry.id));
  return new Set(scope ?? []);
}

export function createSession(caseData: CaseData, userId: Id): SessionState {
  const now = new Date().toISOString();
  return applyInitialUnlocks(caseData, {
    id: crypto.randomUUID(),
    caseId: caseData.caseId,
    userId,
    unlockedEvidenceIds: [],
    completedInterviews: [],
    interrogations: [],
    questionHistory: [],
    actions: [],
    notes: [],
    createdAt: now,
    updatedAt: now
  });
}

export function publicCaseSummary(caseData: CaseData): Pick<CaseData, "caseId" | "title"> & { contentWarnings: string[] } {
  return { caseId: caseData.caseId, title: caseData.title, contentWarnings: caseData.rules.contentWarnings };
}

export function getAccessibleEvidence(caseData: CaseData, session: SessionState): CaseEvidence[] {
  const unlocked = new Set(session.unlockedEvidenceIds);
  return caseData.evidence.filter((evidence) => unlocked.has(evidence.id));
}

export function getAccessibleCharacters(caseData: CaseData, session: SessionState): CaseCharacter[] {
  return caseData.characters.filter((character) => conditionSatisfied(character.unlockCondition, session));
}

export function getVisibleLocations(caseData: CaseData, session: SessionState): CaseLocation[] {
  return caseData.locations.filter(
    (location) => location.initiallyVisible || conditionSatisfied(location.unlockCondition, session)
  );
}

export function getTimeline(caseData: CaseData, session: SessionState) {
  const unlocked = new Set(session.unlockedEvidenceIds);
  return caseData.timeline.filter((entry) =>
    entry.sourceEvidenceIds.every((evidenceId) => unlocked.has(evidenceId))
  );
}

export function getCaseRules(caseData: CaseData): CaseRules {
  return caseData.rules;
}

export function suspectInterrogationMinimumMs(caseData: CaseData): number {
  return caseData.rules.interrogation.minimumDurationMs;
}

export function classifyQuestionIntent(caseData: CaseData, question: string): string | undefined {
  const normalized = normalize(question);
  for (const entry of compiledIntentPatterns(caseData)) {
    if (entry.regex.test(normalized)) return entry.intent;
  }
  return undefined;
}

export function applyPlayerAction(
  caseData: CaseData,
  session: SessionState,
  action: PlayerAction
): UnlockResult {
  if (action.type === "client_request_unlock") {
    return {
      status: "denied",
      session,
      newlyUnlockedEvidenceIds: [],
      reason: "server_only_unlock_evaluation"
    };
  }

  const denial = firstDeniedReason(caseData, session, action);
  if (denial) {
    return { status: "denied", session: touch(session), newlyUnlockedEvidenceIds: [], reason: denial };
  }

  let next = addActionMarkers(caseData, touch(session), action);
  const before = new Set(next.unlockedEvidenceIds);
  next = applyInitialUnlocks(caseData, next);
  // One generation per action: unlock evidence whose prerequisites are met by
  // the pre-action session state (the `before` snapshot), rather than by
  // evidence unlocked during this action's initial-unlock step. A fixed-point
  // cascade would short-circuit stage-gated unlock progressions, so only a
  // single generation runs here and newly unlocked evidence does not chain.
  const referenceSession = { ...next, unlockedEvidenceIds: [...before] };
  const advanceChain = CHAIN_ADVANCE_ACTION_TYPES.has(action.type);
  for (const evidence of caseData.evidence) {
    if (next.unlockedEvidenceIds.includes(evidence.id)) continue;
    if (!conditionSatisfied(evidence.unlockCondition, referenceSession)) continue;
    if (!advanceChain && !isManualStepCondition(evidence.unlockCondition)) continue;
    next = appendUniqueEvidence(next, evidence.id);
  }

  const newlyUnlockedEvidenceIds = next.unlockedEvidenceIds.filter((id) => !before.has(id));
  return { status: "applied", session: next, newlyUnlockedEvidenceIds };
}

export function resolveQuestionTopic(caseData: CaseData, characterId: Id, questionTopic: string | undefined): string | undefined {
  if (!questionTopic) return undefined;
  for (const alias of caseData.rules.topicAliases) {
    if (alias.characterId && alias.characterId !== characterId) continue;
    if (alias.intent && alias.intent !== questionTopic) continue;
    if (alias.intentPrefix && !questionTopic.startsWith(alias.intentPrefix)) continue;
    return alias.topic;
  }
  return questionTopic;
}

function answerFromEvidenceMatching(
  caseData: CaseData,
  session: SessionState,
  characterId: Id,
  question: string
): CharacterReply {
  const character = caseData.characters.find((candidate) => candidate.id === characterId);
  if (!character) {
    return reply("unknown", "Bu karakter vaka dosyasında bulunmuyor.", [], 1);
  }
  if (!conditionSatisfied(character.unlockCondition, session)) {
    return reply("locked", caseData.rules.fallbackTexts.locked, [], 1);
  }
  const accessibleEvidence = getAccessibleEvidence(caseData, session);
  const matchingEvidence = findQuestionEvidence(caseData, character.id, accessibleEvidence, question);
  if (matchingEvidence) {
    return reply("answered", matchingEvidence.facts.join(" "), [matchingEvidence.id], 0.72);
  }
  const statement = character.initialStatement ?? character.knows[0];
  if (statement) {
    return reply("requires_investigation", statement, [], 0.5);
  }
  return reply("unknown", caseData.rules.fallbackTexts.unknown, [], 0.9);
}

export function answerCharacterQuestion(
  caseData: CaseData,
  session: SessionState,
  characterId: Id,
  question: string
): CharacterReply {
  const character = caseData.characters.find((candidate) => candidate.id === characterId);
  if (!character) {
    return reply("unknown", "Bu karakter vaka dosyasında bulunmuyor.", [], 1);
  }
  const normalized = normalize(question);
  const support = accessibleSupportingEvidence(caseData, session, normalized, character.id);
  if (caseData.rules.prosecutorCharacterId !== null && character.id === caseData.rules.prosecutorCharacterId) {
    return reply(
      "answered",
      "Dosyanın ileri incelemeye alınması suçluluğun kesinleşmesi değildir; yalnızca sunulan kurgusal delillerin araştırmaya değer görüldüğünü belirtir.",
      support,
      0.9
    );
  }
  if (!conditionSatisfied(character.unlockCondition, session)) {
    return reply("locked", caseData.rules.fallbackTexts.locked, [], 1);
  }

  if (normalized.includes("gizli") || normalized.includes("kilitli") || normalized.includes("henüz bulmad")) {
    return reply("unknown", "Bulunmamış veya erişime açılmamış deliller hakkında bilgi veremem.", [], 0.95);
  }
  if (normalized.includes("mecit") || normalized.includes("dekont") || /\bgerçek\b/u.test(normalized)) {
    return reply(
      "unknown",
      "Kaynak notları oyun içi delil değildir; doğrulanmamış gerçek olay iddiaları kesin kanıt gibi kullanılamaz.",
      [],
      0.92
    );
  }
  if (character.id === "C01" && normalized.includes("nermin")) {
    return reply("unknown", "Leyla, Nermin'in ödeme tutarını veya özel görüşmesini doğrulayamaz.", [], 0.9);
  }
  const intent = classifyQuestionIntent(caseData, question);
  const accessibleEvidence = getAccessibleEvidence(caseData, session);
  if (!intent) {
    const matchingEvidence = findQuestionEvidence(caseData, character.id, accessibleEvidence, question);
    if (matchingEvidence) {
      return reply("answered", matchingEvidence.facts.join(" "), [matchingEvidence.id], 0.72);
    }
    return reply("unknown", caseData.rules.fallbackTexts.unknown, [], 0.98);
  }
  if (caseData.rules.narrativeStyle === "evidence_matching") {
    return answerFromEvidenceMatching(caseData, session, character.id, question);
  }
  if (normalized.includes("banka") || normalized.includes("transfer") || normalized.includes("kesin")) {
    return reply(
      "requires_investigation",
      "Mevcut erişilebilir dosyada bağımsız ödeme doğrulaması yok; bu konu ek araştırma gerektirir.",
      support,
      0.86
    );
  }
  const paymentEvidence = accessibleEvidence.find((evidence) => evidence.id === "E05");
  const paymentIntent = intent.startsWith("payment_") || intent === "payment_details";
  if (character.id === "C01" && paymentIntent && intent !== "payment_recipient") {
    if (!paymentEvidence) {
      const complaint = accessibleEvidence.find((evidence) => evidence.id === "E01");
      return reply("requires_investigation", complaint ? `${complaint.facts[1]} Ayrıntılı ödeme beyanı henüz dosyada açılmadı.` : "Ödeme ayrıntısı dosyada henüz yok.", complaint ? [complaint.id] : [], 0.68);
    }
    if (intent === "payment_amount") return reply("answered", "E05’te yaklaşık 150.000 TL ödediğimi ifade ettiğim yazıyor. Bu tutar bağımsız olarak doğrulanmış değil.", [paymentEvidence.id], 0.82);
    if (intent === "payment_time") return reply("answered", "E05’te ödemenin 12 Mayıs 2026 günü saat 14.30 civarında yapıldığını söylediğim yazıyor. Bu zaman bilgisi beyanıma dayanıyor.", [paymentEvidence.id], 0.82);
    if (intent === "payment_method") return reply("answered", "E05’te parayı elden verdiğimi ifade ettim. Dosyada bunu bağımsız doğrulayan bir kayıt yok.", [paymentEvidence.id], 0.82);
    if (intent === "payment_reason") {
      const complaint = accessibleEvidence.find((evidence) => evidence.id === "E01");
      return reply("answered", "İlk şikâyette altın vaadiyle bir gösteriye çağrıldığımı ve ödeme yaptığımı bildirdim. Bu, benim beyanım; vaadin gerçekleşeceğini veya ödemenin alıcıya ulaştığını tek başına kanıtlamaz.", complaint ? [complaint.id] : [], 0.76);
    }
  }
  if (character.id === "C01" && intent === "payment_recipient") {
    if (paymentEvidence) {
      return reply(
        "answered",
        "Dosyadaki E05 beyanında 12 Mayıs 2026 günü saat 14.30 civarında 150.000 TL’yi elden verdiğimi söylüyorum. Ancak bu tutanakta parayı kime verdiğimin adı yazmıyor ve alıcı bağımsız olarak doğrulanmış değil. Şu an dosyadan bir alıcı adı çıkaramam; önce çağrıyı yapan tanıdığın ve gösterideki rollerin kim olduğunu netleştirmek gerekiyor.",
        [paymentEvidence.id],
        0.88
      );
    }
    const complaint = accessibleEvidence.find((evidence) => evidence.id === "E01");
    return reply(
      "requires_investigation",
      "İlk şikâyet kaydı yalnızca para verdiğimi bildirdiğimi içeriyor; alıcının adı burada yer almıyor. Ayrıntılı ödeme beyanı açılınca bu kayıtta neyin yazılı olduğunu görebilirsin.",
      complaint ? [complaint.id] : [],
      0.7
    );
  }
  if (character.id === "C01" && intent === "payment_details") {
    if (paymentEvidence) return reply("answered", paymentEvidence.facts.join(" "), [paymentEvidence.id], 0.82);
    const complaint = accessibleEvidence.find((evidence) => evidence.id === "E01");
    return reply("requires_investigation", complaint ? `${complaint.facts[1]} Bu kayıt ödeme teslimini bağımsız olarak doğrulamıyor.` : "Ödeme ayrıntısı dosyada henüz yok.", complaint ? [complaint.id] : [], 0.68);
  }
  if (character.id === "C01" && intent === "promise") {
    const complaint = accessibleEvidence.find((evidence) => evidence.id === "E01");
    return complaint
      ? reply("answered", `İlk tutanakta altın vaadi içeren bir gösteriye çağrıldığımı bildirdiğim yazıyor. ${complaint.facts[0]}`, [complaint.id], 0.75)
      : reply("requires_investigation", "Bu beyan henüz dosyada yok.", [], 0.6);
  }
  const showEvidence = accessibleEvidence.find((evidence) => evidence.id === "E02");
  if (character.id === "C01" && intent === "who_invited") {
    const complaint = accessibleEvidence.find((evidence) => evidence.id === "E01");
    return reply("answered", "İlk tutanakta beni bir tanıdığın aracılığıyla gösteriye çağırdıkları yazıyor. Kimin yönlendirdiği bu kayıtta belirtilmiyor.", complaint ? [complaint.id] : [], 0.78);
  }
  if (character.id === "C01" && (intent === "show_details" || intent === "scene_objects") && showEvidence) {
    return reply(
      "answered",
      "Gösteri sırasında boş kaplar ve örtüler gördüm. O anda ne amaçla kullanıldıklarını bilmiyordum. Bunların orada bulunması tek başına sahtekârlığı kanıtlamaz.",
      [showEvidence.id],
      0.8
    );
  }
  if (character.id === "C01" && (intent === "show_details" || intent === "scene_objects")) {
    const complaint = accessibleEvidence.find((evidence) => evidence.id === "E01");
    return reply("requires_investigation", character.initialStatement ?? "Gösteriyle ilgili ayrıntılar henüz dosyada yok.", complaint ? [complaint.id] : [], 0.68);
  }
  if (character.id === caseData.rules.suspectCharacterId && (intent === "who_invited" || intent === "show_details" || intent === "suspect_response")) {
    const suspectStatement = accessibleEvidence.find((evidence) => evidence.id === "E09");
    if (suspectStatement) return reply("answered", suspectStatement.facts.join(" "), [suspectStatement.id], 0.84);

    const witnessLink = accessibleEvidence.find((evidence) => evidence.id === "E04");
    const corroboration = caseData.rules.interrogation.corroboratingInterview;
    const witnessInterviewed = corroboration !== null && session.completedInterviews.some(
      (interview) => interview.characterId === corroboration.characterId && interview.topic === corroboration.topic
    );
    const normalizedQuestion = normalized.replace(/[?!.,]/gu, "").trim();
    const repeatedQuestion = session.questionHistory.filter(
      (entry) => entry.characterId === caseData.rules.suspectCharacterId && entry.question === normalizedQuestion
    ).length >= caseData.rules.interrogation.repeatedQuestionCount;
    if (witnessLink && witnessInterviewed && repeatedQuestion) {
      return reply(
        "answered",
        "Evet, gösteri günü mekândaydım. Cem de beni orada gördüğünü ifade etti. Bu, mekânda bulunduğumu destekler; ödeme yapıldığını veya kimin düzenlediğini tek başına kanıtlamaz.",
        [witnessLink.id],
        0.83
      );
    }
    if (witnessLink) {
      return reply("requires_investigation", "Mekânda bulunduğuma dair bir tanık beyanı olduğunu görüyorum. Bu iddiayı ayrıntılı yanıtlamam için tanık ifadesini ve diğer kayıtları birlikte değerlendirin.", [witnessLink.id], 0.7);
    }
    return reply("requires_investigation", "Bu konuya ilişkin dosyada henüz doğrulanmış bir kayıt görmüyorum. Önce tanık beyanlarını ve diğer dayanakları araştırın.", [], 0.65);
  }
  if (character.id === "C03" && intent === "scene_objects") {
    if (showEvidence) {
      return reply("answered", "Mekânda kaplar ve örtüler gördüm. Kimin yerleştirdiğini ya da ne amaçla kullanıldığını bilmiyorum.", [showEvidence.id], 0.8);
    }
  }
  if (character.id === "C03" && intent === "promise") {
    return reply("requires_investigation", "Altın vaadi hakkında duyduklarımı doğrulayan bir kayıt sunamam; ben yalnızca mekânda gördüklerimi anlatabilirim.", showEvidence ? [showEvidence.id] : [], 0.62);
  }
  const secondComplaint = accessibleEvidence.find((evidence) => evidence.id === "E06");
  if (character.id === "C04" && secondComplaint) {
    return reply("answered", secondComplaint.facts.join(" "), [secondComplaint.id], 0.75);
  }
  if (character.id === "C02" && paymentIntent) {
    const statement = accessibleEvidence.find((evidence) => evidence.id === "E09");
    return statement
      ? reply("requires_investigation", "E09’da gösteriyi düzenlediğimi kabul ediyor, gerçek altın teslim etme taahhüdünü reddediyorum. Bu tutanak ödeme tutarı veya alıcının kimliğini doğrulamıyor.", [statement.id], 0.76)
      : reply("requires_investigation", "Ödeme iddiasına ilişkin sorgu tutanağı henüz dosyada yok. Önce gerekli kayıtları açıp sorguyu tamamlamak gerekiyor.", [], 0.66);
  }
  if (normalized.includes("banka") || normalized.includes("transfer") || normalized.includes("kesin")) {
    return reply(
      "requires_investigation",
      "Mevcut erişilebilir dosyada bağımsız ödeme doğrulaması yok; bu konu ek araştırma gerektirir.",
      support,
      0.86
    );
  }
  if (normalized.includes("murat") && (normalized.includes("para") || normalized.includes("ödeme"))) {
    return reply(
      "requires_investigation",
      "Erişilebilir tanık ve inceleme verisi ödeme teslimini kesin olgu olarak kurmuyor.",
      support,
      0.84
    );
  }
  const witnessEvidence = accessibleEvidence.find((evidence) => evidence.id === "E04");
  if (character.id === "C03" && witnessEvidence && (intent === "suspect_presence" || intent === "who_invited")) {
    return reply("answered", "Murat’ı gösteri günü mekânda gördüm. Para alışverişini doğrudan görmedim.", [witnessEvidence.id], 0.78);
  }
  const suspectStatement = accessibleEvidence.find((evidence) => evidence.id === "E09");
  if (character.id === "C02" && suspectStatement) {
    return reply("answered", suspectStatement.facts.join(" "), [suspectStatement.id], 0.72);
  }

  const fallback = character.initialStatement ?? "Bu konuda yalnızca kendi bildiklerimi aktarabilirim.";
  return reply("unknown", fallback, [], 0.55);
}

export function calculateCaseStrength(caseData: CaseData, session: SessionState) {
  const evidence = getAccessibleEvidence(caseData, session);
  const reliabilityScore = evidence.reduce((sum, item) => sum + item.reliability * 7, 0);
  const independentBonus = evidence.filter((item) => item.independentVerification).length * 12;
  const breadthBonus = Math.min(20, new Set(evidence.map((item) => item.type)).size * 4);
  const rawScore = Math.min(100, Math.round(reliabilityScore + independentBonus + breadthBonus));
  const weakAreas = caseData.rules.caseStrength.weakAreas
    .filter((area) => weakAreaApplies(area, caseData, session, evidence))
    .map((area) => area.text);
  return { score: rawScore, unlockedEvidenceCount: evidence.length, weakAreas };
}

function weakAreaApplies(
  area: CaseRules["caseStrength"]["weakAreas"][number],
  _caseData: CaseData,
  session: SessionState,
  evidence: CaseEvidence[]
): boolean {
  if (area.requiresIndependentVerification === true) {
    return !evidence.some((item) => item.independentVerification);
  }
  if (area.missingEvidenceIds && area.missingEvidenceIds.length > 0) {
    return area.missingEvidenceIds.some((id) => !session.unlockedEvidenceIds.includes(id));
  }
  return true;
}

export function evaluateProsecutionSubmission(
  caseData: CaseData,
  session: SessionState,
  submission: ProsecutionSubmission
): ProsecutionDecision {
  const now = new Date().toISOString();
  const unlocked = new Set(session.unlockedEvidenceIds);
  const submittedEvidence = caseData.evidence.filter(
    (evidence) => submission.evidenceIds.includes(evidence.id) && unlocked.has(evidence.id)
  );
  const inaccessibleIds = submission.evidenceIds.filter((id) => !unlocked.has(id));
  const reasons: string[] = [];
  const componentScores: Record<string, number> = {};
  for (const component of caseData.rules.prosecution.components) {
    componentScores[component.id] = evaluateProsecutionComponent(
      component.evaluation,
      caseData,
      submission,
      submittedEvidence
    );
  }

  let score = Object.values(componentScores).reduce((sum, value) => sum + value, 0);
  const missingReadiness = caseData.rules.prosecution.readinessEvidenceIds.filter(
    (id) => !submission.evidenceIds.includes(id) || !unlocked.has(id)
  );
  if (missingReadiness.length > 0) {
    reasons.push(`Savcılık hazır olma koşulları eksik: ${missingReadiness.join(", ")}.`);
    score = Math.min(score, 44);
  }
  if (submission.suspectId !== caseData.rules.suspectCharacterId) {
    reasons.push("Yanlış şüpheli seçildi.");
    score = Math.min(score, 30);
  }
  if (inaccessibleIds.length > 0) {
    reasons.push(`Erişilmemiş veya uydurma delil sunuldu: ${inaccessibleIds.join(", ")}.`);
    score = Math.min(score, 30);
  }
  if (submittedEvidence.length < 3) {
    reasons.push("En az üç erişilmiş dayanak delil sunulmadı.");
    score = Math.min(score, 44);
  }
  if (!submission.gaps && !submission.contradictionAnalysis) {
    reasons.push("Çelişki veya eksik doğrulama analizi açıklanmadı.");
  }

  const acceptedMin = outcomeMinScore(caseData, "accepted_for_further_action", 75);
  const returnedMin = outcomeMinScore(caseData, "returned_for_more_evidence", 45);
  const outcome =
    score >= acceptedMin && reasons.length === 0
      ? "accepted_for_further_action"
      : score >= returnedMin && submission.suspectId === caseData.rules.suspectCharacterId && inaccessibleIds.length === 0
        ? "returned_for_more_evidence"
        : "rejected";

  if (outcome === "accepted_for_further_action") {
    reasons.push("Dosya ileri incelemeye alınır; bu sonuç suçluluğun kesinleşmesi değildir.");
  } else if (outcome === "returned_for_more_evidence") {
    reasons.push("Dosya makul bağlantılar içeriyor ancak ek araştırma gerektiriyor.");
  }

  return {
    id: crypto.randomUUID(),
    outcome,
    score,
    reasons,
    componentScores,
    createdAt: now
  };
}

function outcomeMinScore(
  caseData: CaseData,
  outcomeId: "accepted_for_further_action" | "returned_for_more_evidence" | "rejected",
  fallback: number
): number {
  return caseData.prosecution.outcomes.find((outcome) => outcome.id === outcomeId)?.minScore ?? fallback;
}

function evaluateProsecutionComponent(
  evaluation: CaseRules["prosecution"]["components"][number]["evaluation"],
  caseData: CaseData,
  submission: ProsecutionSubmission,
  submittedEvidence: CaseEvidence[]
): number {
  const submittedIds = new Set(submittedEvidence.map((evidence) => evidence.id));
  const hasAnalysis = Boolean(submission.gaps || submission.contradictionAnalysis);
  switch (evaluation.kind) {
    case "suspect_and_any_evidence":
      return submission.suspectId === caseData.rules.suspectCharacterId &&
        evaluation.evidenceIds.some((id) => submittedIds.has(id))
        ? evaluation.points
        : 0;
    case "evidence_tiers": {
      for (const tier of evaluation.tiers) {
        const matched = tier.match === "all"
          ? tier.evidenceIds.every((id) => submittedIds.has(id))
          : tier.evidenceIds.some((id) => submittedIds.has(id));
        if (matched) return tier.points;
      }
      return 0;
    }
    case "evidence_with_analysis": {
      const matched = evaluation.match === "all"
        ? evaluation.evidenceIds.every((id) => submittedIds.has(id))
        : evaluation.evidenceIds.some((id) => submittedIds.has(id));
      if (!matched) return 0;
      return hasAnalysis ? evaluation.pointsWithAnalysis : evaluation.points;
    }
    case "independent_or_fallback":
      if (submittedEvidence.some((evidence) => evidence.independentVerification)) return evaluation.points;
      if (submittedEvidence.length >= evaluation.fallback.minEvidenceCount &&
        (!evaluation.fallback.requiresAnalysis || hasAnalysis)) {
        return evaluation.fallback.points;
      }
      return 0;
    case "analysis_present":
      return hasAnalysis ? evaluation.points : 0;
  }
}

function conditionSatisfied(condition: UnlockCondition | null, session: SessionState): boolean {
  if (condition === null) return true;
  const unlocked = new Set(session.unlockedEvidenceIds);
  const actions = new Set(session.actions);
  if (condition.evidenceIds?.some((evidenceId) => !unlocked.has(evidenceId))) return false;
  if (condition.action && !actions.has(condition.action)) return false;
  if (condition.event && !actions.has(condition.event)) return false;
  if (condition.characterId && !actions.has(`asked:${condition.characterId}:${condition.questionTopic ?? ""}`)) {
    return false;
  }
  if (
    condition.interviewCompleted &&
    !session.completedInterviews.some(
      (interview) =>
        interview.characterId === condition.interviewCompleted &&
        (condition.questionTopic === undefined || interview.topic === condition.questionTopic)
    )
  ) {
    return false;
  }
  if (
    condition.questionTopic &&
    !session.actions.some((action) => action.endsWith(`:${condition.questionTopic}`))
  ) {
    return false;
  }
  return true;
}

function addActionMarkers(caseData: CaseData, session: SessionState, action: PlayerAction): SessionState {
  const actions = new Set(session.actions);
  let completedInterviews = session.completedInterviews;
  let interrogations = session.interrogations;
  let questionHistory = session.questionHistory;
  switch (action.type) {
    case "load_case":
      actions.add("load_case");
      break;
    case "visit_location":
      actions.add(`visited:${action.locationId}`);
      break;
    case "examine_location":
      actions.add(`examined:${action.locationId}`);
      break;
    case "start_interview":
      actions.add(`interview_started:${action.characterId}`);
      if (!interrogations.some((interrogation) => interrogation.characterId === action.characterId)) {
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
        const requiredTopics = new Set(caseData.rules.interrogation.requiredTopics);
        if (action.characterId === caseData.rules.suspectCharacterId && requiredTopics.has(action.topic)) {
          interrogations = interrogations.map((interrogation) => interrogation.characterId === caseData.rules.suspectCharacterId
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
  if (action.type === "examine_location") {
    if (!getVisibleLocations(caseData, session).some((location) => location.id === action.locationId)) {
      return "location_locked_or_unknown";
    }
    if (!session.actions.includes(`visited:${action.locationId}`)) {
      return "location_not_visited";
    }
  }
  if (
    (action.type === "ask_character" || action.type === "complete_interview" || action.type === "start_interview") &&
    !getAccessibleCharacters(caseData, session).some((character) => character.id === action.characterId)
  ) {
    return "character_locked_or_unknown";
  }
  if (action.type === "ask_character" && action.characterId === caseData.rules.suspectCharacterId && !session.interrogations.some((interrogation) => interrogation.characterId === caseData.rules.suspectCharacterId)) {
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
    const missing = caseData.rules.interrogation.completionEvidenceIds.filter((id) => !session.unlockedEvidenceIds.includes(id));
    if (missing.length > 0) return `missing_prerequisite_${missing.join("_")}`;
    const interrogation = session.interrogations.find((item) => item.characterId === caseData.rules.suspectCharacterId);
    if (!interrogation) return "interrogation_not_started";
    const requiredTopics = new Set(caseData.rules.interrogation.requiredTopics);
    const completed = requiredTopics.size === 0
      ? interrogation.questionTopics.length
      : interrogation.questionTopics.filter((topic) => requiredTopics.has(topic)).length;
    if (completed < caseData.rules.interrogation.minimumCompletedTopics) return "interrogation_topics_incomplete";
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
  const allowedIds = evidenceScopeAllows(caseData.rules, characterId, caseData.evidence);
  return caseData.evidence
    .filter((evidence) => unlocked.has(evidence.id))
    .filter((evidence) => allowedIds.has(evidence.id))
    .filter((evidence) => evidence.facts.some((fact) => normalize(fact).split(" ").some((word) => question.includes(word))))
    .map((evidence) => evidence.id)
    .slice(0, 4);
}

function findQuestionEvidence(caseData: CaseData, characterId: Id, accessibleEvidence: CaseEvidence[], question: string): CaseEvidence | undefined {
  const allowedIds = evidenceScopeAllows(caseData.rules, characterId, accessibleEvidence);
  const ignoredWords = new Set([
    "acaba", "bana", "bunu", "biliyor", "diye", "gerçekten", "hangi", "hakkında", "nasıl", "nerede",
    "oldu", "olmuş", "sence", "söyler", "söyle", "şey", "var", "yok", "mi", "mı", "mu", "mü"
  ]);
  const words = normalize(question)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length >= 4 && !ignoredWords.has(word));
  if (words.length === 0) return undefined;

  function factWords(evidence: CaseEvidence): string[] {
    return normalize(evidence.facts.join(" "))
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/u);
  }

  let best: CaseEvidence | undefined;
  let bestScore: [number, number] = [0, 0];
  for (const evidence of accessibleEvidence) {
    if (!allowedIds.has(evidence.id)) continue;
    const facts = factWords(evidence);
    let exact = 0;
    let total = 0;
    for (const questionWord of words) {
      const matched = facts.some((factWord) => {
        if (factWord === questionWord) {
          exact++;
          return true;
        }
        return (
          Math.min(factWord.length, questionWord.length) >= 5 &&
          (factWord.startsWith(questionWord.slice(0, 5)) ||
            questionWord.startsWith(factWord.slice(0, 5)))
        );
      });
      if (matched) total++;
    }
    if (exact > bestScore[0] || (exact === bestScore[0] && total > bestScore[1])) {
      bestScore = [exact, total];
      best = evidence;
    }
  }
  return best;
}