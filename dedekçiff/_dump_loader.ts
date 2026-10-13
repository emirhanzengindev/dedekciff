import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseData, ProsecutionRules } from "@case-001/shared";
import {
  characterSchema,
  evidenceSchema,
  locationSchema,
  timelineEntrySchema
} from "@case-001/validation";
import { z } from "zod";

interface ReadmeFile {
  caseId: string;
  title: string;
}

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

export function loadCaseData(caseId = "case-001", root = findRepoRoot()): CaseData {
  const dir = join(root, "cases", caseId);
  const readme = loadJson<ReadmeFile>(join(dir, "README.json"));
  const charactersDoc = loadJson<{ characters: unknown[] }>(join(dir, "characters.json"));
  const evidenceDoc = loadJson<{ evidence: unknown[] }>(join(dir, "evidence.json"));
  const mapDoc = loadJson<{ locations: unknown[] }>(join(dir, "map.json"));
  const timelineDoc = loadJson<{ timeline: unknown[] }>(join(dir, "timeline.json"));
  const prosecutionDoc = loadJson<ProsecutionRules>(join(dir, "prosecution.json"));

  return {
    caseId: readme.caseId,
    title: readme.title,
    characters: z.array(characterSchema).parse(charactersDoc.characters),
    evidence: z.array(evidenceSchema).parse(evidenceDoc.evidence),
    locations: z.array(locationSchema).parse(mapDoc.locations),
    timeline: z.array(timelineEntrySchema).parse(timelineDoc.timeline),
    prosecution: prosecutionDoc
  };
}
