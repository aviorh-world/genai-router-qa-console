# GenAI Router QA Console v1.2

QA console for Router Swagger 1.0.6, enriched with project context received on 2026-09-14.

## v1.2 changes
- TSH execution modes: Browser Direct, Vercel Proxy, or Postman/cURL generator.
- Bearer token helper: Google CLI flow note + 60-minute expiry countdown.
- Default App ID `Desktop` and sample Case ID `123456789` per Swagger/team guidance.
- User ID guidance for the internal `@taxes` email.
- New project-context tab: known facts, remaining blockers, architecture map, candidate architecture tests and reference links.
- Contract gaps updated with TSH/NON-PROD networking, AlloyDB state/logs, Model Armor, GCS and service-account boundaries.
- Test catalog still contains the original 78 Swagger scenarios; 3 open questions are now marked partially clarified.
- cURL generation never embeds the real bearer token; it uses `<BEARER_TOKEN>` placeholder.

## Important
A public Vercel deployment may not be able to reach an internal TSH endpoint. Prefer Browser Direct from an authorized network or copy the generated cURL into Postman inside SH/TSH.
