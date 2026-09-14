# GenAI Router QA Console v1.3

Update highlights:
- Default QA user: `aviorha@taxes.gov.il`
- Google Identity Token flow documented: `gcloud auth print-identity-token`
- Default auth header: `X-Serverless-Authorization: Bearer <TOKEN>`
- Optional `gcloud init` / `gcloud init --no-launch-browser` guidance
- Added 16 systematic boundary tests (total 94 scenarios) and a Run Boundary Pack button
- Token stays session-only and is not exported to reports

Still required before real execution: exact TSH Base URL and confirmation that the cloud user is authorized to invoke the Router.
