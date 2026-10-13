# Final Validation Report — case-002 unlock regression fix (packages/case-engine)

## 1. Re-ran the two validation commands

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **exit 0** | `tsc -p tsconfig.json --noEmit` clean |
| `pnpm test` | **2 test files, 48 passed, 0 failed, exit 0** | Run via `vitest run` |

Both commands were re-executed from `packages/case-engine` after the fix and remain green.

## 2. Case-001 and Case-002 load via the existing loader

Both packs exist at the repo root as separate directories:
- `cases/case-001/README.json`
- `cases/case-002/README.json`

`loadCaseData` resolves `cases/<caseId>/README.json` from `findRepoRoot()` (the directory containing `pnpm-workspace.yaml`). The two test files respectively load their own packs:
- `fixtures.test.ts` → `loadCaseData("case-001", root)`
- `case-002.test.ts` → `loadCaseData("case-002", root)`

Both loads succeed; no loader change was required. Schema validation and `validateCaseIntegrity` all pass, including the "independently verified" documentary-attribution warning in Case-002 and the "show_room" map-tension warning in Case-001.

## 3. Case-001 previous behaviour preserved

The `before`-snapshot fix lives **only inside `applyPlayerAction` in `engine.ts`**. Case-001 has 30 fixture tests exercising the same `applyPlayerAction` path and **all still pass**, proving the fix does not alter Case-001 behaviour. These are the case-001 evidence-unlock fixture (EU01–EU07), character-knowledge fixture (CK01–CK06), map/interview progression (13 tests), timeline, case integrity, and case strength/prosecution.

## 4. Case-002 evidence unlock stages

From `cases/case-002/evidence.json`:
- E01 → initial (unconditional)
- E02, E03, E04, E05 → require E01
- E06, E07, E08 → require E05
- E09 → requires E06, E07
- E10 → requires E08, E09

Traced against the fix:

| EU | initial | action | newly unlocked | match |
|---|---|---|---|---|
| C2-01 | [] | load_case | [E01] | ✅ |
| C2-02 | [E01] | load_case | [E02,E03,E04,E05] | ✅ |
| C2-03 | [E01,E05] | load_case | [E06,E07,E08] | ✅ |
| C2-04 | [E06,E07] | load_case | [E09] | ✅ |
| C2-05 | [E08,E09] | load_case | [E10] | ✅ |
| C2-06 | [E01] | client_request_unlock(E10) | denied → server_only_unlock_evaluation | ✅ |

Mechanism: `before` is the pre-action `unlockedEvidenceIds` set captured after `addActionMarkers` but before `applyInitialUnlocks`; a single-generation cascade evaluates `conditionSatisfied(...)` against a `referenceSession` whose `unlockedEvidenceIds` is the `before` snapshot, so newly-unlocked evidence cannot chain within the same action.

## 5. findQuestionEvidence mapping verified via existing tests

`findQuestionEvidence` was **not changed** by this fix; it still uses Unicode property escapes (`/[^\p{L}\p{N}\s]/gu`), correctly handling Turkish/accented characters. Existing tests verify scope filtering and evidence matching: `case-002.test.ts` "answers in-scope questions from unlocked evidence only" and "withholds out-of-scope knowledge from other characters"; `fixtures.test.ts` CK01–CK06, "does not answer a question from evidence outside the character knowledge scope" (C01 cannot answer about E09), "does not make the victim interviewable", and "does not invent lab details missing from transcript".

## 6. No mixing between the two cases

Two independent test files load separate packs and fixtures. The case-002 "case isolation" test asserts case-001 constants do NOT leak (`suspectCharacterId === "char-convicted"`, not "C02"; `characterEvidenceScope` has no "C01"). Case-001's own fixture runner uses only case-001 data.

## 7. _cmp.cjs untouched

`packages/case-engine/src/_cmp.cjs` verified intact (pre-existing debug script, not part of build/test). Pre-existing `_splice.cjs`, `_debug.cjs`, `case-002-unlock-debug.test.ts` confirmed absent. `vitest.config.ts` confirmed absent.

## 8. No new temp files / no real defect found

No new temp files created. The only stray file in the case-engine `src` tree is the pre-existing `_cmp.cjs`, left as-is. No real defect found: typecheck exit 0, 48 passed / 0 failed, and the unlock-condition extraction confirms EU-C2-01…06 expectations are meaningful (real precondition chains).

## Files changed / not changed

| File | Status |
|---|---|
| `packages/case-engine/src/engine.ts` | changed (`applyPlayerAction` single-generation cascade uses `before` snapshot) |
| `_cmp.cjs` | unchanged (pre-existing) |
| `vitest.config.ts`, `_splice.cjs`, `_debug.cjs`, `case-002-unlock-debug.test.ts` | removed/confirmed absent |
| case packs, `package.json`, `src/index.ts` | untouched |

## Remaining risk

None critical. `git diff`/`git status` is unreliable in this repo root because many unrelated personal files are untracked; file contents and test outcomes were verified directly. All 48 tests + typecheck green plus manual trace provide sufficient confidence.
