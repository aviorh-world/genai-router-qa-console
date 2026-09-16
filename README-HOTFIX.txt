GenAI Router QA Console — hotfix 0.02.3

Changed:
1. Supports the deployed UI payload contract that sends a full `url`.
2. Repairs duplicated endpoint paths such as:
   /v1/conversations/new/v1/conversations/history
   by executing the last /v1/... endpoint.
3. Sends the same Identity Token in BOTH:
   X-Serverless-Authorization
   Authorization
4. Uses the confirmed Router base:
   https://chat-router-942568278050.me-west1.run.app/ita-chat-router-api
5. Adds redacted diagnostics and QA Proxy Log ID.
6. Never writes the token value to diagnostics.

Replace only api/proxy.js and redeploy.
