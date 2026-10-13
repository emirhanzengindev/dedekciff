import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseData, ProsecutionRules } from "@case-001/shared";
import {
  characterSchema,
  caseRulesSchema,
  evidenceSchema,
  locationSchema,
  timelineEntrySchema
} from "@case-001/validation";
import { z } from "zod";

interface ReadmeFile {
  caseId: string;
  title: string;
}

export const DEFAULT_CASE_ID = "case-001";
const CASE_ID_PATTERN = /^case-\d{3}$/;

export function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = dirname(current);
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Lists loadable case packs. Only directories matching the strict case id
 * pattern are considered, so client input is never joined into a path.
 */
export function listCases(root = findRepoRoot()): string[] {
  const casesDir = join(root, "cases");
  if (!existsSync(casesDir)) return [];
  return readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && CASE_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .filter((caseId) => existsSync(join(casesDir, caseId, "README.json")))
    .sort();
}

export function isSupportedCaseId(caseId: string, root = findRepoRoot()): boolean {
  return CASE_ID_PATTERN.test(caseId) && listCases(root).includes(caseId);
}

export function loadCaseData(caseId = DEFAULT_CASE_ID, root = findRepoRoot()): CaseData {
  if (!CASE_ID_PATTERN.test(caseId) || !existsSync(join(root, "cases", caseId, "README.json"))) {
    throw new Error(`case_not_found: ${caseId}`);
  }
  const dir = join(root, "cases", caseId);
  let readme: ReadmeFile;
  let rules: CaseData["rules"];
  try {
    readme = loadJson<ReadmeFile>(join(dir, "README.json"));
  } catch (error) {
    throw new Error(`case_pack_invalid: ${caseId}/README.json is missing or unreadable (${messageOf(error)})`);
  }
  if (readme.caseId !== caseId) {
    throw new Error(`case_pack_invalid: ${caseId}/README.json declares caseId "${readme.caseId}"`);
  }
  if (typeof readme.title !== "string" || readme.title.length === 0) {
    throw new Error(`case_pack_invalid: ${caseId}/README.json is missing a title`);
  }
  try {
    rules = caseRulesSchema.parse(loadJson(join(dir, "rules.json"))) as CaseData["rules"];
  } catch (error) {
    throw new Error(`case_pack_invalid: ${caseId}/rules.json failed validation (${messageOf(error)})`);
  }
  const charactersDoc = loadJson<{ characters: unknown[] }>(join(dir, "characters.json"));
  const evidenceDoc = loadJson<{ evidence: unknown[] }>(join(dir, "evidence.json"));
  const mapDoc = loadJson<{ locations: unknown[] }>(join(dir, "map.json"));
  const timelineDoc = loadJson<{ timeline: unknown[] }>(join(dir, "timeline.json"));
  const prosecutionDoc = loadJson<ProsecutionRules>(join(dir, "prosecution.json"));

  return {
    caseId: readme.caseId,
    title: readme.title,
    rules,
    characters: z.array(characterSchema).parse(charactersDoc.characters),
    evidence: z.array(evidenceSchema).parse(evidenceDoc.evidence),
    locations: z.array(locationSchema).parse(mapDoc.locations),
    timeline: z.array(timelineEntrySchema).parse(timelineDoc.timeline),
    prosecution: prosecutionDoc
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
