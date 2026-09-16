# GenAI Router QA Console 0.02

QA console for the GenAI Router / RAG project.

## What changed in 0.02

- Added **QA Investigation** for each executed test. It first performs a local evidence-based analysis and distinguishes Product Bug, environment/prerequisite, test-data and Contract questions.
- Added optional **Deep AI Investigation** through a server-side OpenAI Responses API route. Runtime evidence is redacted before it is sent; Identity Tokens and the AI access code are never included in the model payload.
- Added **Run Investigation** to summarize the current test run, separate real FAILs from BLOCKED/N/A/QUESTION results, and suggest an investigation order.
- Added **Azure Bug Draft** generation with Title, Environment, Test Case, Endpoint, Steps, Expected, Actual, QA Investigation and Runtime Evidence metadata. Drafts can be copied or exported as Markdown.
- Added a **Status filter** to the test catalog.
- Added dashboard KPIs for **BLOCKED** and **QUESTION**.
- Added lightweight **Run History** stored only in localStorage. It stores summary counts only — not credentials and not Request/Response payloads.
- Fixed an existing **Golden Bug Evidence** export defect caused by an undefined variable.
- Preserved the existing Run All, Evidence, Golden Regression, RAG/AI guide, Boundary Pack, RAG Spec Pack and Console Self-Test capabilities.

## Deep AI Investigation setup (optional)

The site works without AI configuration. Local evidence analysis remains available.

To enable the server-side AI investigator on Vercel, configure:

```text
AI_INVESTIGATE_ENABLED=true
AI_INVESTIGATE_ACCESS_CODE=<a private access code>
OPENAI_API_KEY=<server-side OpenAI API key>
OPENAI_MODEL=gpt-5.6-luna
```

Then open **Advanced Settings** in the console, enter the same AI Investigation Access Code and enable the AI Investigation checkbox.

The access code is sent only to the QA server for authorization. It is not added to the model prompt. The OpenAI key is server-side only.

## Safety / environment notes

- Use TSH/QA credentials only. Do not use Production credentials.
- Identity Tokens are not persisted and are redacted from Evidence.
- The public Vercel UI may not be able to reach an internal TSH endpoint. Use Browser Direct or Postman from the approved network when required.
- AI analysis is advisory. PASS/FAIL must continue to be based on Runtime Evidence and the agreed Expected Result, not on an LLM guess.

## TSH Router target

- Base URL: `https://t-sh-apic.taxes.gov.il/ita-chat-router-api`
- API paths from Swagger already start with `/v1`; the console normalizes a pasted Base URL ending in `/v1` to avoid `/v1/v1`.
- `GET /health` is attempted without an Identity Token first, so connectivity can be separated from authentication when the environment allows it.


## Methodological E2E Flows
Auto Flow includes Conversation Lifecycle, Continue Previous Conversation, Multi-Conversation Isolation, Case Isolation, and Golden RAG Journey. State is propagated automatically between steps.


## Structured API Runner
API Runner now exposes all Swagger operations through a structured endpoint selector, endpoint-specific fields, full URL, request/header preview, advanced JSON, direct execution and cURL. Authorization preview follows the team instruction: `Authorization: Bearer <token>` and `Content-Type: application/json`.


## API Runner update
API Runner defaults to POST /v1/conversations/new, uses Authorization: Bearer <token>, and exposes structured fields for all Swagger 1.0.6 operations. Health remains GET /health because that is the method defined by Swagger 1.0.6.

## API Runner environments
The runner now has two explicit environments:
- Sandbox: `https://chat-router-942568278050.me-west1.run.app`, `gcloud auth print-identity-token`, `X-Serverless-Authorization`, default `userId=Ofir`.
- NonProd / TSH: `https://t-sh-apic.taxes.gov.il/ita-chat-router-api`, `gcloud auth print-access-token`, default `userId=aviorha@ita.gov.il`. The auth header is editable in the runner.
The full URL is always visible and editable. Tokens are displayed unmasked. Bearer is added automatically.

## API Runner proxy hotfix
API Runner requests are now sent Browser → `/api/proxy` → selected target environment, avoiding browser CORS/preflight failures against Cloud Run/APIC. The full target URL remains visible/editable in the UI. Sandbox default userId is now `aviorha@ita.gov.il`. The proxy allowlist includes the Sandbox Router, Sandbox direct RAG service, and TSH APIC host; additional hosts can still be added with `TSH_ALLOWED_HOSTS`.


## Global Connection Profiles
The console now has one global Environment selector used by automated tests, Auto Flow, GenAI/RAG and API Runner. Sandbox uses `https://chat-router-942568278050.me-west1.run.app/ita-chat-router-api`, Identity Token, `X-Serverless-Authorization`, and defaults to Vercel Proxy. NonProd / TSH uses `https://t-sh-apic.taxes.gov.il/ita-chat-router-api`, Access Token, `Authorization`, and defaults to Browser Direct. Tokens are kept separately per environment in browser session storage. API Runner inherits the global profile; per-request URL and optional auth override remain available.

Case ID note: Swagger 1.0.6 defines exactly 9 digits, while the newer Sandbox email example contains 10 digits. The console therefore shows the contradiction and does not locally block numeric Case IDs.

## Mobile token helper
The global Connection Profile help now includes a collapsed mobile helper:
- Direct link to Google Cloud Shell terminal.
- One-click copy of the active environment's download command.
- Sandbox: `gcloud auth print-identity-token > ~/sandbox-token.txt && cloudshell download ~/sandbox-token.txt`
- NonProd: `gcloud auth print-access-token > ~/nonprod-token.txt && cloudshell download ~/nonprod-token.txt`
The UI reminds the tester to paste only the token; `Bearer ` is added automatically.

## v0.02 focused Golden / Judge update
- GenAI/RAG Inspector now auto-creates a conversation when no `conversationId` exists, stores the returned ID, sends the message, parses SSE and fetches referenced chunks.
- Inspector shows Technical Test Result separately from AI Evaluation Result.
- Golden Dataset supports Question, Expected Answer, Required Points and Expected Sources/Citations.
- Golden results separate API/SSE technical status from AI quality status.
- Judge dimensions: Correctness, Completeness, Grounding and Hallucination severity.
- Configurable thresholds determine AI PASS/FAIL when the required evidence is available.
- When Deep AI is enabled, `/api/ai-investigate` supports `mode=judge` and returns structured LLM Judge JSON. Otherwise a clearly labeled heuristic fallback is used.
- Sources/Chunks/Citations are rendered explicitly; `/v1/conversations/fetch/chunks/text` is called automatically for Inspector and optionally for Golden runs.
