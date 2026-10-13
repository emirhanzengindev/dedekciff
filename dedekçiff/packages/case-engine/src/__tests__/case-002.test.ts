import { describe, expect, it } from "vitest";
import {
  answerCharacterQuestion,
  applyPlayerAction,
  calculateCaseStrength,
  createSession,
  evaluateProsecutionSubmission,
  getAccessibleCharacters,
  getVisibleLocations,
  isSupportedCaseId,
  listCases,
  loadCaseData,
  loadJson,
  findRepoRoot,
  validateCaseIntegrity
} from "../index.js";
import type { PlayerAction, SessionState } from "@case-001/shared";
import { join } from "node:path";

const root = findRepoRoot();
const caseData = loadCaseData("case-002", root);

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

describe("case-002 pack loading", () => {
  it("is listed among supported cases and loads with schema validation", () => {
    expect(listCases(root)).toContain("case-002");
    expect(isSupportedCaseId("case-002", root)).toBe(true);
    expect(caseData.caseId).toBe("case-002");
    expect(caseData.evidence).toHaveLength(10);
    expect(caseData.characters).toHaveLength(7);
  });

  it("has no integrity errors and keeps documentary attribution warnings", () => {
    const report = validateCaseIntegrity(caseData);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join(" ")).toContain("independently verified");
  });

  it("rejects path traversal and unknown case ids", () => {
    expect(isSupportedCaseId("../case-001", root)).toBe(false);
    expect(isSupportedCaseId("case-999", root)).toBe(false);
    expect(() => loadCaseData("case-999", root)).toThrow("case_not_found");
    expect(() => loadCaseData("../case-001", root)).toThrow("case_not_found");
  });

  it("keeps timeline dates at source granularity", () => {
    const byId = new Map(caseData.timeline.map((entry) => [entry.id, entry]));
    expect(byId.get("T01")?.timestamp).toBe("2008-04-10");
    expect(byId.get("T07")?.timestamp).toBe("2009-09");
    for (const entry of caseData.timeline) {
      expect(entry.status).toContain("documentary_claim");
    }
  });
});

describe("case-002 evidence unlock fixture", () => {
  const fixture = loadJson<{
    cases: Array<{
      id: string;
      initialEvidenceIds: string[];
      action: Record<string, unknown>;
      expectedUnlockedEvidenceIds?: string[];
      expectedLockedEvidenceIds?: string[];
      expectedResult?: "denied";
      expectedReason?: string;
    }>;
  }>(join(root, "cases/case-002/tests/evidence-unlocks.json"));

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
    });
  }

  it("mirrors source location tests: evidence opens its map locations", () => {
    const withE01 = sessionWithEvidence(["E01"]);
    const locationsE01 = getVisibleLocations(caseData, withE01).map((location) => location.id);
    expect(locationsE01).toContain("LOC-home");
    expect(locationsE01).toContain("LOC-kitchen");

    const withE02 = sessionWithEvidence(["E02"]);
    expect(getVisibleLocations(caseData, withE02).map((location) => location.id)).toContain("LOC-window");

    const withE03 = sessionWithEvidence(["E03"]);
    expect(getVisibleLocations(caseData, withE03).map((location) => location.id)).toContain("LOC-upstairs");

    const withE09 = sessionWithEvidence(["E09"]);
    expect(getVisibleLocations(caseData, withE09).map((location) => location.id)).toContain("LOC-school");
  });
});


describe("case-002 character knowledge", () => {
  it("never makes the victim interviewable", () => {
    const full = sessionWithEvidence(caseData.evidence.map((evidence) => evidence.id));
    expect(getAccessibleCharacters(caseData, full).map((character) => character.id)).not.toContain("char-victim");
    const reply = answerCharacterQuestion(caseData, full, "char-victim", "Olay günü ne oldu?");
    expect(reply.status).toBe("locked");
  });

  it("does not invent lab details missing from the transcript", () => {
    const reply = answerCharacterQuestion(
      caseData,
      sessionWithEvidence(["E01", "E05", "E06", "E07"]),
      "char-mcdaniel",
      "Laboratuvar DNA istatistiği yüzde kaç çıktı?"
    );
    expect(reply.status).not.toBe("answered");
    expect(reply.answer).not.toMatch(/%\d|\d+\.\d+/);
  });

  it("answers in-scope questions from unlocked evidence only", () => {
    const reply = answerCharacterQuestion(
      caseData,
      sessionWithEvidence(["E01", "E05", "E08"]),
      "char-mcdaniel",
      "Sakız örneği olayı neydi?"
    );
    expect(reply.status).toBe("answered");
    expect(reply.answer.toLocaleLowerCase("tr-TR")).toContain("sakız");
  });

  it("withholds out-of-scope knowledge from other characters", () => {
    const heather = answerCharacterQuestion(
      caseData,
      sessionWithEvidence(["E01", "E03"]),
      "char-heather",
      "Üst kattaki mücadele izleri neydi?"
    );
    expect(heather.status).not.toBe("answered");

    const camp = answerCharacterQuestion(
      caseData,
      sessionWithEvidence(["E01", "E06"]),
      "char-initial-suspect",
      "Chris Short neden elendi?"
    );
    expect(camp.status).not.toBe("answered");
    expect(camp.answer).not.toContain("Short");
  });
});

describe("case-002 strength and prosecution", () => {
  it("keeps scores deterministic without AI", () => {
    const session = sessionWithEvidence(["E01", "E05", "E08", "E09", "E10"]);
    expect(calculateCaseStrength(caseData, session)).toEqual(calculateCaseStrength(caseData, session));
  });

  it("rejects wrong-suspect and incomplete submissions, accepts a fully supported one", () => {
    const full = sessionWithEvidence(["E01", "E05", "E06", "E07", "E08", "E09", "E10"]);

    const wrongSuspect = evaluateProsecutionSubmission(caseData, full, {
      suspectId: "C02",
      crimeSummary: "Yanlış vaka şüphelisi.",
      evidenceIds: ["E01", "E05", "E08", "E09", "E10"],
      contradictionAnalysis: "Analiz.",
      gaps: "Boşluk."
    });
    expect(wrongSuspect.outcome).toBe("rejected");
    expect(wrongSuspect.reasons.join(" ")).toContain("Yanlış şüpheli");

    const incomplete = evaluateProsecutionSubmission(caseData, full, {
      suspectId: "char-convicted",
      crimeSummary: "Eksik hazır olma seti.",
      evidenceIds: ["E01", "E05"],
      contradictionAnalysis: "Analiz.",
      gaps: "Boşluk."
    });
    expect(incomplete.outcome).toBe("rejected");
    expect(incomplete.reasons.join(" ")).toContain("hazır olma");

    const strong = evaluateProsecutionSubmission(caseData, full, {
      suspectId: "char-convicted",
      crimeSummary: "Belgesel anlatımına göre olay yeri, DNA anlatımı, elenmeler, sakız örneği olayı ve şüpheli anlatımı birlikte sunulur.",
      motive: "Reddedilme yalnızca belgeseldeki teori olarak değerlendirilir.",
      evidenceIds: ["E01", "E05", "E06", "E07", "E08", "E09", "E10"],
      contradictionAnalysis: "Maskeli saldırgan anlatımı üst kat bulgularıyla çelişir; sakız örneği güvenilir eşleşme değildir.",
      gaps: "Tüm bulgular belgesel anlatımıdır; bağımsız laboratuvar veya mahkeme kaydı dosyada yoktur."
    });
    expect(strong.outcome).toBe("accepted_for_further_action");
    expect(strong.reasons.join(" ")).toContain("suçluluğun kesinleşmesi değildir");
  });
});

describe("case isolation", () => {
  it("does not leak case-001 constants into case-002", () => {
    expect(caseData.rules.suspectCharacterId).toBe("char-convicted");
    expect(caseData.rules.suspectCharacterId).not.toBe("C02");
    expect(Object.keys(caseData.rules.characterEvidenceScope)).not.toContain("C01");
    const strength = calculateCaseStrength(caseData, sessionWithEvidence(["E01"]));
    expect(strength.weakAreas.join(" ")).not.toContain("Ödeme iddiası");
  });
});
