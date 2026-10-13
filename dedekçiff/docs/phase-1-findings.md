# Phase 1 Findings

## ZIP Inventory

The supplied archive was extracted into `cases/case-001`.

- `README.json`
- `source_notes.json`
- `characters.json`
- `evidence.json`
- `timeline.json`
- `question_rules.json`
- `prosecution.json`
- `map.json`
- `tests/evidence-unlocks.json`
- `tests/character-knowledge.json`
- `tests/timeline-consistency.json`

## Data Shape

- Characters: 5 fictional records (`C01`-`C05`).
- Evidence: 10 fictional gameplay records (`E01`-`E10`).
- Locations: 4 map records.
- Timeline: 6 fictional gameplay entries with ISO timestamps and evidence references.
- Source notes: historical reporting/adaptation context only; not gameplay evidence.

## Integrity Results

No duplicate IDs or broken direct references were found by the implemented validator.

Warnings:

- `map.json` has a visibility tension: `show_room` has an explicit unlock condition based on `E01`, Leyla interview completion, and `show_details`, while `visibilityRules` also says `E02` shows `show_room`. The backend treats explicit location/evidence unlock conditions as authoritative.
- Only `E03` has `independentVerification: true`; prosecution acceptance should therefore require careful gap/contradiction analysis.
- `tests/evidence-unlocks.json` expects the machine assertion `independent_payment_not_verified` for `E10`. The Turkish fact text already says this semantically, so `E10.factCodes` was added as a non-narrative validation code.

## Security Boundaries

- All unlocks are evaluated by `packages/case-engine`; client-submitted `client_request_unlock` is denied.
- Source notes are never treated as in-game proof.
- API serializers expose only current session-visible characters, locations, and evidence.
- No `canonicalSolution` object was present in the ZIP. If one is added later, it must remain server-only.

## Phase 2 Started

Implemented:

- Zod schemas for case pack validation and API request validation.
- Case loader.
- Evidence unlock evaluator.
- Map visibility evaluator.
- Character knowledge-gated reply logic.
- Case strength service.
- Deterministic prosecution service.
- Vitest coverage for supplied JSON fixtures.
