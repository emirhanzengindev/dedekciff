import { describe, expect, it } from "vitest";
import {
  answerCharacterQuestion,
  applyPlayerAction,
  calculateCaseStrength,
  createSession,
  evaluateProsecutionSubmission,
  getTimeline,
  getVisibleLocations,
  loadCaseData,
  validateCaseIntegrity
} from "../index.js";
import { loadJson, findRepoRoot } from "../loader.js";
import type { PlayerAction, SessionState } from "@case-001/shared";
import { join } from "node:path";

const root = findRepoRoot();
const caseData = loadCaseData("case-001", root);

function sessionWithEvidence(evidenceIds: string[]): SessionState {
  const session = createSession(caseData, "test-user");
  return { ...session, unlockedEvidenceIds: [...new Set(evidenceIds)] };
}

function actionFromFixture(action: Record<string, unknown>): PlayerAction {
  switch (action.type) {
    case "complete_interview":
      return {
        type: "complete_interview",
        characterId: String(action.characterId),
        topic: String(action.topic)
      };
    case "ask_character":
      return {
        type: "ask_character",
        characterId: String(action.characterId),
        question: "fixture question",
        topic: String(action.topic)
      };
    case "client_request_unlock":
      return { type: "client_request_unlock", evidenceId: String(action.evidenceId) };
    case "load_case":
    case "search_similar_complaints":
    case "request_object_examination":
    case "inspect_phone_messages":
    case "compare_victim_statements":
    case "interview_suspect":
    case "cross_check_payment_claim":
      return { type: action.type };
    default:
      throw new Error(`Unsupported fixture action ${String(action.type)}`);
  }
}

describe("case integrity", () => {
  it("validates references and reports known map tension as a warning", () => {
    const report = validateCaseIntegrity(caseData);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join(" ")).toContain("show_room");
  });
});

describe("evidence unlock fixture", () => {
  const fixture = loadJson<{
    cases: Array<{
      id: string;
      initialEvidenceIds: string[];
      action: Record<string, unknown>;
      expectedUnlockedEvidenceIds?: string[];
      expectedLockedEvidenceIds?: string[];
      expectedResult?: "denied";
      expectedReason?: string;
      expectedFactMustInclude?: string;
    }>;
  }>(join(root, "cases/case-001/tests/evidence-unlocks.json"));

  for (const testCase of fixture.cases) {
    it(testCase.id, () => {
      const session = sessionWithEvidence(testCase.initialEvidenceIds);
      const result = applyPlayerAction(caseData, session, actionFromFixture(testCase.action));
      if (testCase.expectedResult === "denied") {
        expect(result.status).toBe("denied");
        expect(result.reason).toBe(testCase.expectedReason);
        return;
      }
      expect(result.status).toBe("applied");
      for (const evidenceId of testCase.expectedUnlockedEvidenceIds ?? []) {
        expect(result.session.unlockedEvidenceIds).toContain(evidenceId);
      }
      for (const evidenceId of testCase.expectedLockedEvidenceIds ?? []) {
        expect(result.session.unlockedEvidenceIds).not.toContain(evidenceId);
      }
      if (testCase.expectedFactMustInclude) {
        const evidence = caseData.evidence.find((item) => item.id === result.newlyUnlockedEvidenceIds[0]);
        expect([...(evidence?.facts ?? []), ...(evidence?.factCodes ?? [])].join(" ")).toContain(
          testCase.expectedFactMustInclude
        );
      }
    });
  }
});

describe("map and interview progression", () => {
  it("opens the show room only after the Leyla interview topic is completed", () => {
    const initial = createSession(caseData, "test-user");
    expect(getVisibleLocations(caseData, initial).map((location) => location.id)).not.toContain("show_room");

    const result = applyPlayerAction(caseData, initial, {
      type: "ask_character",
      characterId: "C01",
      question: "Gösteride ne gördün?",
      topic: "show_details"
    });

    expect(result.status).toBe("applied");
    expect(result.session.unlockedEvidenceIds).toContain("E02");
    expect(getVisibleLocations(caseData, result.session).map((location) => location.id)).toContain("show_room");
  });

  it("does not record or allow a visit to a locked location", () => {
    const initial = createSession(caseData, "test-user");
    const result = applyPlayerAction(caseData, initial, { type: "visit_location", locationId: "show_room" });

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("location_locked_or_unknown");
    expect(result.session.actions).not.toContain("visited:show_room");
  });

  it("answers payment questions from Leyla's opened statement and cites its evidence", () => {
    const initial = createSession(caseData, "test-user");
    const result = applyPlayerAction(caseData, initial, {
      type: "ask_character",
      characterId: "C01",
      question: "Ödeme tutarı ne kadardı?",
      topic: "payment_details"
    });
    const answer = answerCharacterQuestion(caseData, result.session, "C01", "Ödeme tutarı ne kadardı?");

    expect(result.session.unlockedEvidenceIds).toContain("E05");
    expect(answer.answer).toContain("150.000 TL");
    expect(answer.supportingEvidenceIds).toContain("E05");
  });

  it("states that the payment recipient is not named instead of inventing one", () => {
    const initial = createSession(caseData, "test-user");
    const beforeStatement = answerCharacterQuestion(caseData, initial, "C01", "Parayı kime verdin?");
    expect(beforeStatement.status).toBe("requires_investigation");
    expect(beforeStatement.answer).toContain("alıcının adı burada yer almıyor");

    const paymentInterview = applyPlayerAction(caseData, initial, {
      type: "ask_character",
      characterId: "C01",
      question: "Parayı kime verdin?",
      topic: "payment_details"
    });
    const afterStatement = answerCharacterQuestion(caseData, paymentInterview.session, "C01", "Parayı kime verdin?");
    expect(afterStatement.status).toBe("answered");
    expect(afterStatement.supportingEvidenceIds).toEqual(["E05"]);
    expect(afterStatement.answer).toContain("150.000 TL’yi elden verdiğimi söylüyorum");
    expect(afterStatement.answer).toContain("bu tutanakta parayı kime verdiğimin adı yazmıyor");
  });

  it("answers payment amount, date, and method as separate attributed facts", () => {
    const session = sessionWithEvidence(["E01", "E05"]);
    const questions = [
      { text: "Ne kadar para verdin?", expected: "150.000 TL" },
      { text: "Ödemeyi hangi tarihte yaptın?", expected: "12 Mayıs 2026" },
      { text: "Parayı nasıl teslim ettin?", expected: "elden verdiğimi" }
    ];
    const answers = questions.map(({ text }) => answerCharacterQuestion(caseData, session, "C01", text));

    for (const [index, item] of questions.entries()) {
      expect(answers[index]?.answer).toContain(item.expected);
      expect(answers[index]?.supportingEvidenceIds).toEqual(["E05"]);
    }
    expect(new Set(answers.map((answer) => answer.answer)).size).toBe(3);
  });

  it("opens the suspect residence only after witness identification evidence", () => {
    const initial = createSession(caseData, "test-user");
    const sceneVisit = applyPlayerAction(caseData, initial, {
      type: "ask_character",
      characterId: "C01",
      question: "Gösteri alanında ne vardı?",
      topic: "show_details"
    });
    const witnessReply = applyPlayerAction(caseData, sceneVisit.session, {
      type: "ask_character",
      characterId: "C03",
      question: "Murat'ı kim gösteri alanında gördü?",
      topic: "who_arranged_show"
    });

    expect(witnessReply.session.unlockedEvidenceIds).toContain("E04");
    expect(getVisibleLocations(caseData, witnessReply.session).map((location) => location.id)).toContain("suspect_home");
  });

  it("does not advance on an unclassified question", () => {
    const initial = createSession(caseData, "test-user");
    const reply = answerCharacterQuestion(caseData, initial, "C01", "Bana tüm sırları anlat");

    expect(reply.status).toBe("unknown");
    expect(reply.answer).toContain("Bu soruyu anlayamadım");
    expect(reply.supportingEvidenceIds).toEqual([]);
  });

  it("allows an explicit early finish after two topics and the required evidence", () => {
    const initial = {
      ...sessionWithEvidence(["E01", "E07", "E08"]),
      interrogations: [{ characterId: "C02", startedAt: new Date().toISOString(), questionTopics: ["show_details"] }]
    };
    const incomplete = applyPlayerAction(caseData, initial, { type: "interview_suspect" });
    expect(incomplete.status).toBe("denied");
    expect(incomplete.reason).toBe("interrogation_topics_incomplete");

    const earlyReady = {
      ...initial,
      interrogations: [{ ...initial.interrogations[0]!, questionTopics: ["show_details", "payment_details"] }]
    };
    const completed = applyPlayerAction(caseData, earlyReady, { type: "interview_suspect" });
    expect(completed.status).toBe("applied");
    expect(completed.session.unlockedEvidenceIds).toContain("E09");
  });

  it("reveals only the corroborated point after the same suspect question is repeated", () => {
    const session = {
      ...sessionWithEvidence(["E01", "E02", "E04"]),
      completedInterviews: [{ characterId: "C03", topic: "who_arranged_show" }],
      questionHistory: [
        { characterId: "C02", question: "murat gösteriyi düzenledi mi", topic: "who_invited", askedAt: "2026-10-12T00:00:00.000Z" },
        { characterId: "C02", question: "murat gösteriyi düzenledi mi", topic: "who_invited", askedAt: "2026-10-12T00:00:10.000Z" }
      ]
    };
    const answer = answerCharacterQuestion(caseData, session, "C02", "Murat gösteriyi düzenledi mi?");

    expect(answer.status).toBe("answered");
    expect(answer.answer).toContain("mekândaydım");
    expect(answer.answer).not.toContain("para aldım");
    expect(answer.supportingEvidenceIds).toEqual(["E04"]);
  });

  it("gives different answers for an invitation question and a scene question", () => {
    const session = sessionWithEvidence(["E01", "E02"]);
    const invitation = answerCharacterQuestion(caseData, session, "C01", "Seni gösteriye kim çağırdı?");
    const scene = answerCharacterQuestion(caseData, session, "C01", "Gösteri alanında neler vardı?");

    expect(invitation.supportingEvidenceIds).toContain("E01");
    expect(scene.supportingEvidenceIds).toContain("E02");
    expect(invitation.answer).not.toBe(scene.answer);
    expect(scene.answer).toContain("Gösteri sırasında boş kaplar ve örtüler gördüm");
    expect(scene.answer).not.toContain("Kurgusal sahnede");
  });

  it("retrieves a relevant opened fact when a story question is phrased differently", () => {
    const session = sessionWithEvidence(["E02", "E04"]);
    const answer = answerCharacterQuestion(caseData, session, "C03", "Cem, Murat'ı mekânda görmüş müydü?");

    expect(answer.status).toBe("answered");
    expect(answer.supportingEvidenceIds).toContain("E04");
    expect(answer.answer).toContain("Murat’ı gösteri günü mekânda gördüm");
  });

  it("does not answer a question from evidence outside the character knowledge scope", () => {
    const session = sessionWithEvidence(caseData.evidence.map((evidence) => evidence.id));
    const answer = answerCharacterQuestion(caseData, session, "C01", "Muratın savunma tutanağı ne söylüyor?");

    expect(answer.status).toBe("unknown");
    expect(answer.supportingEvidenceIds).not.toContain("E09");
  });
});

describe("character knowledge fixture", () => {
  const fixture = loadJson<{
    cases: Array<{
      id: string;
      characterId: string;
      question: string;
      unlockedEvidenceIds: string[];
      expectedStatus: string;
      mustInclude?: string[];
      mustNotReveal?: string[];
      mustNotStateAsFact?: string[];
    }>;
  }>(join(root, "cases/case-001/tests/character-knowledge.json"));

  for (const testCase of fixture.cases) {
    it(testCase.id, () => {
      const reply = answerCharacterQuestion(
        caseData,
        sessionWithEvidence(testCase.unlockedEvidenceIds),
        testCase.characterId,
        testCase.question
      );
      expect(reply.status).toBe(testCase.expectedStatus);
      for (const text of testCase.mustInclude ?? []) {
        expect(reply.answer.toLocaleLowerCase("tr-TR")).toContain(text.toLocaleLowerCase("tr-TR"));
      }
      for (const text of [...(testCase.mustNotReveal ?? []), ...(testCase.mustNotStateAsFact ?? [])]) {
        expect(reply.answer).not.toContain(text);
      }
    });
  }
});

describe("timeline fixture", () => {
  it("keeps visible timeline ordered and evidence-backed", () => {
    const session = sessionWithEvidence(caseData.evidence.map((evidence) => evidence.id));
    const timeline = getTimeline(caseData, session);
    const timestamps = timeline.map((entry) => Date.parse(entry.timestamp));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    for (const entry of timeline) {
      expect(entry.status).toBeTruthy();
      expect(entry.certainty).toBeTruthy();
    }
  });
});

describe("case strength and prosecution", () => {
  it("scores identical state deterministically without AI", () => {
    const session = sessionWithEvidence(["E01", "E02", "E03", "E04", "E05", "E07", "E08"]);
    expect(calculateCaseStrength(caseData, session)).toEqual(calculateCaseStrength(caseData, session));
  });

  it("rejects inaccessible evidence and accepts a well-supported fictional submission", () => {
    const early = evaluateProsecutionSubmission(caseData, sessionWithEvidence(["E01"]), {
      suspectId: "C02",
      crimeSummary: "Murat hakkinda erken basvuru.",
      evidenceIds: ["E01", "E10"]
    });
    expect(early.outcome).toBe("rejected");

    const strong = evaluateProsecutionSubmission(
      caseData,
      sessionWithEvidence(["E01", "E02", "E03", "E04", "E05", "E07", "E08", "E09", "E10"]),
      {
        suspectId: "C02",
        crimeSummary: "Kurgusal gösteri, beyanlar ve inceleme raporu birlikte sunulur.",
        evidenceIds: ["E03", "E04", "E05", "E09", "E10"],
        contradictionAnalysis: "Odeme teslimi bagimsiz dogrulanmamistir.",
        gaps: "Banka transferi yoktur; bu eksiklik dosyada acikca belirtilir."
      }
    );
    expect(strong.outcome).toBe("accepted_for_further_action");
    expect(strong.reasons.join(" ")).toContain("suçluluğun kesinleşmesi değildir");
  });
});
