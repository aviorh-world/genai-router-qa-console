# GenAI Router QA Console v1.5

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
