import { describe, expect, it } from "vitest";
import {
  answerCharacterQuestion,
  applyPlayerAction,
  createSession,
  loadCaseData,
  findRepoRoot
} from "../index.js";
import type { PlayerAction, SessionState } from "@case-001/shared";

const root = findRepoRoot();
const caseData = loadCaseData("case-002", root);

function sessionWithEvidence(evidenceIds: string[]): SessionState {
  const session = createSession(caseData, "test-user");
  return { ...session, unlockedEvidenceIds: [...new Set(evidenceIds)] };
}

function newlyUnlockedBy(action: PlayerAction, initialEvidenceIds: string[]): string[] {
  const result = applyPlayerAction(caseData, sessionWithEvidence(initialEvidenceIds), action);
  expect(result.status).toBe("applied");
  return result.newlyUnlockedEvidenceIds;
}

function newlyUnlockedByAfterVisit(action: PlayerAction, session: SessionState): string[] {
  const result = applyPlayerAction(caseData, session, action);
  expect(result.status).toBe("applied");
  return result.newlyUnlockedEvidenceIds;
}

describe("player-controlled documentary progression (case-002)", () => {
  it("does not open the evidence chain when the player merely visits a location", () => {
    const unlocked = newlyUnlockedBy({ type: "visit_location", locationId: "LOC-kitchen" }, ["E01"]);
    expect(unlocked).toEqual([]);
  });

  it("does not open the evidence chain when the player starts a conversation", () => {
    const unlocked = newlyUnlockedBy(
      { type: "ask_character", characterId: "char-heather", question: "Megan'la nasÄ±l tanÄ±ÅŸtÄ±n?" },
      ["E01"]
    );
    expect(unlocked).toEqual([]);
  });

  it("does not open the evidence chain when the player starts an interview", () => {
    const unlocked = newlyUnlockedBy({ type: "start_interview", characterId: "char-heather" }, ["E01"]);
    expect(unlocked).toEqual([]);
  });

  it("denies examining a location before the player has visited it", () => {
    const result = applyPlayerAction(caseData, sessionWithEvidence(["E01"]), {
      type: "examine_location",
      locationId: "LOC-kitchen"
    });
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("location_not_visited");
  });

  it("denies examining a location that is not visible yet", () => {
    const visited = applyPlayerAction(caseData, sessionWithEvidence(["E01"]), {
      type: "visit_location",
      locationId: "LOC-window"
    });
    expect(visited.status).toBe("denied");
    expect(visited.reason).toBe("location_locked_or_unknown");

    const result = applyPlayerAction(caseData, sessionWithEvidence(["E01"]), {
      type: "examine_location",
      locationId: "LOC-window"
    });
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("location_locked_or_unknown");
  });

  it("advances exactly one stage when the player explicitly examines a visited location", () => {
    const visited = applyPlayerAction(caseData, sessionWithEvidence(["E01"]), {
      type: "visit_location",
      locationId: "LOC-kitchen"
    });
    expect(visited.status).toBe("applied");
    expect(visited.newlyUnlockedEvidenceIds).toEqual([]);

    const unlocked = newlyUnlockedByAfterVisit({ type: "examine_location", locationId: "LOC-kitchen" }, visited.session);
    expect(unlocked.sort()).toEqual(["E02", "E03", "E04", "E05"]);
  });

  it("does not cascade further stages from a single examination", () => {
    const atKitchen = applyPlayerAction(caseData, sessionWithEvidence(["E01"]), {
      type: "visit_location",
      locationId: "LOC-kitchen"
    });
    const first = applyPlayerAction(caseData, atKitchen.session, {
      type: "examine_location",
      locationId: "LOC-kitchen"
    });
    expect(first.session.unlockedEvidenceIds).not.toContain("E06");

    const atWindow = applyPlayerAction(caseData, first.session, {
      type: "visit_location",
      locationId: "LOC-window"
    });
    expect(atWindow.status).toBe("applied");
    const second = applyPlayerAction(caseData, atWindow.session, {
      type: "examine_location",
      locationId: "LOC-window"
    });
    expect(second.newlyUnlockedEvidenceIds.sort()).toEqual(["E06", "E07", "E08"]);
    expect(second.session.unlockedEvidenceIds).not.toContain("E09");
  });

  it("keeps load_case as the fixture-defined stage action", () => {
    const unlocked = newlyUnlockedBy({ type: "load_case" }, ["E01"]);
    expect(unlocked.sort()).toEqual(["E02", "E03", "E04", "E05"]);
  });

  it("still answers from unlocked evidence without inventing new unlocks", () => {
    const session = sessionWithEvidence(["E01"]);
    const reply = answerCharacterQuestion(caseData, session, "char-mcdaniel", "Olay yeri nasÄ±l tarif ediliyor?");
    expect(reply.status).not.toBe("denied");
    expect(session.unlockedEvidenceIds).toEqual(["E01"]);
  });
});
