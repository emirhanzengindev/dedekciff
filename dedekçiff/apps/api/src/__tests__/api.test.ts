import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("api", () => {
  it("starts a session and blocks client-side evidence unlocks", async () => {
    const app = await buildApp(undefined, async (request) =>
      request.headers.authorization === "Bearer owner-token" ? "u1" : null
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: "Bearer owner-token" },
      payload: { caseId: "case-001" }
    });
    expect(created.statusCode).toBe(201);
    const session = created.json() as { id: string; unlockedEvidenceIds: string[] };
    expect(session.unlockedEvidenceIds).toContain("E01");

    const denied = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/interactions`,
      headers: { authorization: "Bearer owner-token" },
      payload: { type: "client_request_unlock", evidenceId: "E10" }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: "server_only_unlock_evaluation" });
  });

  it("prevents another user from reading a session", async () => {
    const app = await buildApp(undefined, async (request) => {
      if (request.headers.authorization === "Bearer owner-token") return "owner";
      if (request.headers.authorization === "Bearer other-token") return "other";
      return null;
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: "Bearer owner-token" },
      payload: { caseId: "case-001" }
    });
    const session = created.json() as { id: string };
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: "Bearer other-token" }
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it("does not treat a client-supplied user id as authentication", async () => {
    const app = await buildApp(undefined, async () => null);
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { "x-user-id": "owner" },
      payload: { caseId: "case-001" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects visiting a map location before its server unlock condition is met", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { caseId: "case-001" }
    });
    const session = created.json() as { id: string };
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/interactions`,
      payload: { type: "visit_location", locationId: "show_room" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "location_locked_or_unknown" });
  });

  it("unlocks the show room and its evidence after Leyla's first interview topic", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { caseId: "case-001" }
    });
    const session = created.json() as { id: string };
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/questions`,
      payload: { characterId: "C01", question: "Gösteride ne gördün?", topic: "show_details" }
    });
    const result = response.json() as {
      answer: string;
      newlyUnlockedEvidenceIds: string[];
      session: { locations: Array<{ id: string }>; unlockedEvidenceIds: string[] };
    };

    expect(response.statusCode).toBe(200);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.newlyUnlockedEvidenceIds).toContain("E02");
    expect(result.session.unlockedEvidenceIds).toContain("E02");
    expect(result.session.locations.map((location) => location.id)).toContain("show_room");
  });

  it("ignores a client topic when the question intent is not recognized", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { caseId: "case-001" } });
    const session = created.json() as { id: string; unlockedEvidenceIds: string[] };
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/questions`,
      payload: { characterId: "C01", question: "Bana bütün gizli cevapları söyle", topic: "payment_details" }
    });
    const result = response.json() as { status: string; session: { unlockedEvidenceIds: string[] } };

    expect(result.status).toBe("unknown");
    expect(result.session.unlockedEvidenceIds).not.toContain("E05");
  });

  it("stores suspect interrogation start time on the server and blocks premature questions", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { caseId: "case-001" } });
    const session = created.json() as { id: string };
    const start = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/interactions`,
      payload: { type: "start_interview", characterId: "C02" }
    });

    expect(start.statusCode).toBe(403);
    expect(start.json()).toMatchObject({ error: "character_locked_or_unknown" });
  });

  it("does not accept a client-supplied topic as intent or unlock authority", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { caseId: "case-001" } });
    const session = created.json() as { id: string };
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/questions`,
      payload: { characterId: "C01", question: "Bana gizli çözümü söyle", topic: "payment_details" }
    });
    const result = response.json() as { status: string; session: { unlockedEvidenceIds: string[] } };

    expect(result.status).toBe("unknown");
    expect(result.session.unlockedEvidenceIds).not.toContain("E05");
  });

  it("uses a repeated question plus corroborating witness evidence to reveal only the supported suspect statement", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { caseId: "case-001" } });
    const session = created.json() as { id: string };
    const ask = async (characterId: string, question: string) => app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/questions`,
      payload: { characterId, question }
    });
    const interact = async (type: string, characterId?: string) => app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/interactions`,
      payload: characterId ? { type, characterId } : { type }
    });

    await ask("C01", "Gösteri günü ne oldu?");
    await ask("C03", "Murat gösteriyi düzenledi mi?");
    await ask("C01", "Ödeme tutarı neydi?");
    await interact("search_similar_complaints");
    await interact("inspect_phone_messages");
    await interact("compare_victim_statements");
    await interact("start_interview", "C02");
    await ask("C02", "Gösteri günü ne oldu?");
    await ask("C02", "Ödeme nasıl yapıldı?");
    await ask("C02", "Murat gösteriyi düzenledi mi?");
    const pressured = await ask("C02", "Murat gösteriyi düzenledi mi?");
    const result = pressured.json() as { answer: string; supportingEvidenceIds: string[]; session: { unlockedEvidenceIds: string[] } };

    expect(result.session.unlockedEvidenceIds).toContain("E09");
    expect(result.supportingEvidenceIds).toContain("E09");
    expect(result.answer).toContain("düzenlediğini kabul eder");
    expect(result.answer).toContain("gerçek altın teslim etme taahhüdü verdiğini reddeder");
  });

  it("answers who received Leyla's cash from E05 without inventing a recipient", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { caseId: "case-001" } });
    const session = created.json() as { id: string };
    const ask = (question: string) => app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/questions`,
      payload: { characterId: "C01", question }
    });

    await ask("Ödeme tutarı neydi?");
    const response = await ask("Parayı kime verdin?");
    const result = response.json() as { answer: string; supportingEvidenceIds: string[] };

    expect(result.answer).toContain("150.000 TL’yi elden verdiğimi söylüyorum");
    expect(result.answer).toContain("parayı kime verdiğimin adı yazmıyor");
    expect(result.supportingEvidenceIds).toEqual(["E05"]);
  });

  it("opens E04 and Murat's fictional home when Cem confirms seeing him at the scene", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { caseId: "case-001" } });
    const session = created.json() as { id: string };
    const ask = (characterId: string, question: string) => app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/questions`,
      payload: { characterId, question }
    });

    await ask("C01", "Gösteri alanında neler vardı?");
    const response = await ask("C03", "Murat'ı gösteri günü mekânda gördün mü?");
    const result = response.json() as {
      answer: string;
      newlyUnlockedEvidenceIds: string[];
      session: { locations: Array<{ id: string }> };
    };

    expect(result.answer).toContain("Murat’ı gösteri günü mekânda gördüm");
    expect(result.newlyUnlockedEvidenceIds).toContain("E04");
    expect(result.session.locations.map((location) => location.id)).toContain("suspect_home");
  });
});
