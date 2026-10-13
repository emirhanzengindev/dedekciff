import type { CaseData, Id } from "@case-001/shared";

export interface IntegrityReport {
  errors: string[];
  warnings: string[];
}

export function validateCaseIntegrity(caseData: CaseData): IntegrityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const evidenceIds = new Set(caseData.evidence.map((evidence) => evidence.id));
  const characterIds = new Set(caseData.characters.map((character) => character.id));
  const locationIds = new Set(caseData.locations.map((location) => location.id));

  collectDuplicates(caseData.evidence.map((evidence) => evidence.id), "evidence", errors);
  collectDuplicates(caseData.characters.map((character) => character.id), "character", errors);
  collectDuplicates(caseData.locations.map((location) => location.id), "location", errors);

  for (const evidence of caseData.evidence) {
    if (!locationIds.has(evidence.locationId)) errors.push(`${evidence.id} references missing location ${evidence.locationId}.`);
    checkConditionRefs(evidence.unlockCondition?.evidenceIds, evidenceIds, `${evidence.id}.unlockCondition`, errors);
    for (const unlockedEvidenceId of evidence.unlocks.evidence ?? []) {
      if (!evidenceIds.has(unlockedEvidenceId)) errors.push(`${evidence.id} unlocks missing evidence ${unlockedEvidenceId}.`);
    }
    for (const characterId of evidence.unlocks.characters ?? []) {
      if (!characterIds.has(characterId)) errors.push(`${evidence.id} unlocks missing character ${characterId}.`);
    }
    for (const locationId of evidence.unlocks.locations ?? []) {
      if (!locationIds.has(locationId)) errors.push(`${evidence.id} unlocks missing location ${locationId}.`);
    }
  }

  for (const character of caseData.characters) {
    checkConditionRefs(character.unlockCondition?.evidenceIds, evidenceIds, `${character.id}.unlockCondition`, errors);
  }
  for (const location of caseData.locations) {
    checkConditionRefs(location.unlockCondition?.evidenceIds, evidenceIds, `${location.id}.unlockCondition`, errors);
  }
  for (const entry of caseData.timeline) {
    checkConditionRefs(entry.sourceEvidenceIds, evidenceIds, `${entry.id}.sourceEvidenceIds`, errors);
    if (!entry.status || !entry.certainty) errors.push(`${entry.id} is missing status or certainty.`);
  }

  const showRoom = caseData.locations.find((location) => location.id === "show_room");
  if (showRoom?.unlockCondition?.evidenceIds?.includes("E01")) {
    warnings.push(
      "show_room has an explicit unlock condition based on E01 plus Leyla interview, while map visibilityRules mention E02; server condition is treated as authoritative."
    );
  }
  if (!caseData.evidence.some((evidence) => evidence.independentVerification)) {
    warnings.push("No independently verified evidence exists; prosecution acceptance should be difficult.");
  }

  validateCaseRules(caseData, characterIds, evidenceIds, errors);

  return { errors, warnings };
}

function validateCaseRules(
  caseData: CaseData,
  characterIds: Set<Id>,
  evidenceIds: Set<Id>,
  errors: string[]
): void {
  const rules = (caseData as { rules?: unknown }).rules;
  if (!rules || typeof rules !== "object") {
    errors.push("Case pack is missing required rules.json configuration.");
    return;
  }
  const parsed = rules as {
    suspectCharacterId?: unknown;
    prosecutorCharacterId?: unknown;
    interrogation?: {
      requiredTopics?: unknown;
      completionEvidenceIds?: unknown;
      corroboratingInterview?: { characterId?: unknown; topic?: unknown } | null;
    };
    characterEvidenceScope?: Record<string, unknown>;
    caseStrength?: { weakAreas?: Array<{ id?: unknown; missingEvidenceIds?: unknown }> };
    prosecution?: { readinessEvidenceIds?: unknown; components?: Array<{ id?: unknown }> };
    topicAliases?: Array<{ characterId?: unknown }>;
  };

  if (typeof parsed.suspectCharacterId !== "string" || !characterIds.has(parsed.suspectCharacterId)) {
    errors.push(`rules.suspectCharacterId "${String(parsed.suspectCharacterId)}" does not match a known character.`);
  }
  if (parsed.prosecutorCharacterId !== null &&
    (typeof parsed.prosecutorCharacterId !== "string" || !characterIds.has(parsed.prosecutorCharacterId))) {
    errors.push(`rules.prosecutorCharacterId "${String(parsed.prosecutorCharacterId)}" does not match a known character.`);
  }
  for (const evidenceId of parsed.interrogation?.completionEvidenceIds as Id[] ?? []) {
    if (!evidenceIds.has(evidenceId)) errors.push(`rules.interrogation.completionEvidenceIds references missing evidence ${evidenceId}.`);
  }
  const corroboration = parsed.interrogation?.corroboratingInterview;
  if (corroboration && typeof corroboration.characterId === "string" && !characterIds.has(corroboration.characterId)) {
    errors.push(`rules.interrogation.corroboratingInterview.characterId "${corroboration.characterId}" does not match a known character.`);
  }
  for (const [characterId, scope] of Object.entries(parsed.characterEvidenceScope ?? {})) {
    if (!characterIds.has(characterId)) {
      errors.push(`rules.characterEvidenceScope references missing character ${characterId}.`);
      continue;
    }
    if (scope === "*") continue;
    for (const evidenceId of Array.isArray(scope) ? scope as Id[] : []) {
      if (!evidenceIds.has(evidenceId)) errors.push(`rules.characterEvidenceScope[${characterId}] references missing evidence ${evidenceId}.`);
    }
  }
  for (const area of parsed.caseStrength?.weakAreas ?? []) {
    for (const evidenceId of Array.isArray(area?.missingEvidenceIds) ? area.missingEvidenceIds as Id[] : []) {
      if (!evidenceIds.has(evidenceId)) errors.push(`rules.caseStrength.weakAreas["${String(area?.id)}"] references missing evidence ${evidenceId}.`);
    }
  }
  for (const evidenceId of (parsed.prosecution?.readinessEvidenceIds ?? []) as Id[]) {
    if (!evidenceIds.has(evidenceId)) errors.push(`rules.prosecution.readinessEvidenceIds references missing evidence ${evidenceId}.`);
  }
  const componentIds = new Set<string>();
  for (const component of parsed.prosecution?.components ?? []) {
    const id = component?.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push("rules.prosecution.components entries must define a non-empty id.");
      continue;
    }
    if (componentIds.has(id)) errors.push(`Duplicate prosecution component id ${id}.`);
    componentIds.add(id);
  }
  for (const alias of parsed.topicAliases ?? []) {
    if (typeof alias?.characterId === "string" && !characterIds.has(alias.characterId)) {
      errors.push(`rules.topicAliases references missing character ${alias.characterId}.`);
    }
  }
  const scoringIds = new Set(caseData.prosecution.scoring.components.map((component) => component.id));
  for (const id of componentIds) {
    if (!scoringIds.has(id)) {
      errors.push(`rules.prosecution.components["${id}"] has no matching prosecution.scoring component.`);
    }
  }
}

function checkConditionRefs(refs: Id[] | undefined, allowed: Set<Id>, label: string, errors: string[]) {
  for (const ref of refs ?? []) {
    if (!allowed.has(ref)) errors.push(`${label} references missing evidence ${ref}.`);
  }
}

function collectDuplicates(ids: Id[], label: string, errors: string[]) {
  const seen = new Set<Id>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`Duplicate ${label} id ${id}.`);
    seen.add(id);
  }
}
