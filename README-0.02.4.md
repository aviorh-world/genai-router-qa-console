# GenAI Router QA Console 0.02.4 — Vercel Diagnostic

This is the full Vercel site package.

## Main change
Adds **Exact Postman Diagnostic**. It bypasses the normal API Runner/proxy URL-building logic and performs one fixed request from Vercel directly to:

`POST https://chat-router-942568278050.me-west1.run.app/ita-chat-router-api/v1/conversations/new`

with the confirmed body:

```json
{"appId":"Desktop","userId":"aviorha@ita.gov.il","caseId":"123456789"}
```

The Identity Token supplied in the UI is sent in both headers:

- `X-Serverless-Authorization: Bearer <token>`
- `Authorization: Bearer <token>`

The token is never returned in diagnostics or written to logs.

## Interpretation
- `ROUTER_REACHED_CREATE_OK` / HTTP 201: Vercel can reach the Router; debug the normal site proxy/client path.
- `SECURITY_GATE_BLOCKED`: an HTML blocking page was detected between Vercel and Router.
- `UPSTREAM_AUTH_OR_AUTHZ_REJECTED`: request reached an upstream component that returned 401/403 without the known blocking page.
- `VERCEL_FETCH_ERROR`: Vercel could not complete the outbound fetch.

## Deploy
Upload/deploy the entire folder to Vercel as before. No npm dependencies are required.
