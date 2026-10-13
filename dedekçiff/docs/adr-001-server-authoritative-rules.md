# ADR-001: Server-Authoritative Game Rules

## Decision

Evidence unlocks, character availability, map visibility, case strength, and prosecution outcomes are calculated on the backend/domain engine.

## Rationale

The case pack contains hidden or gated facts. The mobile client is an interaction surface and must not become authority for `isUnlocked`, `caseStrength`, prosecution outcomes, or character knowledge.

## Consequences

- Client unlock requests are treated as untrusted input.
- API responses are serialized from server session state.
- Tests can verify gameplay rules without a real AI provider.
