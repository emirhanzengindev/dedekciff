# Case-001 Game

Mobile-first detective game MVP for the fictional case "Cil Cil Altinlar".

## Status

This repository starts from the supplied `case-001` JSON pack. The current MVP implements:

- Data loading and validation boundaries for the case pack.
- Deterministic evidence unlocks, map visibility, character answers, case strength, and prosecution evaluation.
- Fastify API with server-side authority, Supabase session persistence when configured, and in-memory storage for local development.
- Expo Router mobile shell wired to the API shape.
- Vitest tests generated from the supplied JSON fixtures.
- Supabase SQL migration with RLS policies for user-owned session data.

The real-event notes are preserved only as source/adaptation context. Gameplay characters, evidence, dates, amounts, and outcomes are fictional.

## Commands

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm dev:api
pnpm dev:mobile
```

## Security Notes

- `canonicalSolution` and hidden metadata must remain server-only. The current case pack does not include a `canonicalSolution` object, and API serializers expose only player-accessible records.
- Client-submitted unlock state is ignored. The backend evaluates unlocks from session state and case rules.
- With `SUPABASE_URL` and `SUPABASE_ANON_KEY`, the API validates bearer tokens through Supabase Auth. Production startup also requires `SUPABASE_SERVICE_ROLE_KEY` for server-owned session and submission writes.
- `OpenAIProvider` is optional. Without `AI_PROVIDER=openai` and server-side `OPENAI_API_KEY`, the deterministic `MockAIProvider` is used.
- Supabase service role keys are backend-only and must never be exposed through `EXPO_PUBLIC_*` variables.

## Supabase Setup

Apply all migrations in `supabase/migrations`. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the API environment. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the mobile environment to enable sign-in and access-token forwarding. The public anon key may be bundled in the app; the service role key must remain API-only. Without Supabase configuration, non-production runs use a fixed demo identity and in-memory sessions; that mode is not suitable for deployment.

## Known Gaps

- The mobile app is a functional shell for the MVP flow, not a polished production UI.
- Supabase migrations and persistence are covered with adapter tests, but no live Supabase project credentials are available here, so the migrations and RLS behavior have not been exercised against PostgreSQL.
- Maestro tests are included as a smoke-flow specification but were not run because no Android/iOS simulator or connected device is available here.
