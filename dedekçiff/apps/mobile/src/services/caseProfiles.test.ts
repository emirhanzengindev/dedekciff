import { describe, expect, it } from "vitest";
import { getCaseProfile, listCaseProfiles } from "./caseProfiles";

describe("mobile case selection fallback", () => {
  it("lists both registered cases so the selection screen always offers case-001 and case-002", () => {
    const caseIds = listCaseProfiles().map((profile) => profile.caseId);
    expect(caseIds).toContain("case-001");
    expect(caseIds).toContain("case-002");
  });

  it("resolves a distinct profile per case so selecting case-002 does not show case-001 copy", () => {
    const case001 = getCaseProfile("case-001");
    const case002 = getCaseProfile("case-002");
    expect(case001.caseId).toBe("case-001");
    expect(case002.caseId).toBe("case-002");
    expect(case002.title).not.toBe(case001.title);
    expect(case002.eyebrow).not.toBe(case001.eyebrow);
  });

  it("falls back to a neutral data-driven profile for an unknown case instead of crashing", () => {
    const profile = getCaseProfile("case-999");
    expect(profile.caseId).toBe("case-999");
    expect(profile.title.length).toBeGreaterThan(0);
  });

  it("defaults to case-001 when no case id is provided", () => {
    expect(getCaseProfile(undefined).caseId).toBe("case-001");
  });
});
