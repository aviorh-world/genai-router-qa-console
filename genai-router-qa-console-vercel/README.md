# GenAI Router QA Console v1.7

Update highlights:
- Default QA user: `aviorha@taxes.gov.il`
- Google Identity Token flow documented: `gcloud auth print-identity-token`
- Default auth header: `X-Serverless-Authorization: Bearer <TOKEN>`
- Optional `gcloud init` / `gcloud init --no-launch-browser` guidance
- Added 16 systematic boundary tests (total 94 scenarios) and a Run Boundary Pack button
- Token stays session-only and is not exported to reports

Still required before real execution: exact TSH Base URL and confirmation that the cloud user is authorized to invoke the Router.


## v1.5
נוספו STP ו-STD בעברית בתוך האתר, כולל תכנית בדיקות, תנאי כניסה/יציאה, אסטרטגיית בדיקות, Traceability וייצוא Markdown.


## v1.5
- Demo results are marked DEMO, never PASS.
- Added Request/Response evidence with redacted token and cURL copy.
- Added Run All Tests; missing prerequisites become N/A.
- Happy Flow now reports visible errors and switches to its results tab.
- Added UI Self Test and button feedback toasts.
- Fixed topbar contrast.


## v1.7
- Collapsible TSH / Google CLI safety guidance.
- Added RAG Generic Spec tab, explicitly marked as Target Design.
- Added 14 assisted RAG spec test cases (authorization, filtered retrieval, ingestion state, re-ingestion, versioning, config, audit, Top-K quality).
- Added RAG Spec Pack; unavailable/instrumentation-dependent tests become N/A in bulk runs.
- Added SQL/observability tables and RAG quality flow from the supplied specification.
- API section from the source is explicitly marked incomplete because the source itself ends it with 'להשלים!!'.


## v1.7 UX
- Reduced top-level navigation to 8 tabs.
- Unified Contract gaps + open questions under System Guide.
- Unified STP + STD under QA Documents.
- Added general usage guide, core flows, result-status guide and a Hebrew guide for all 23 Swagger endpoints.
- Simplified environment setup; advanced fields are collapsed.
- Removed the Copy Questions button.
