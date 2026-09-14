# GenAI Router QA Console v2.1

QA console for the GenAI Router / RAG project.

## v2.1

- Golden Release Sanity with local Run history and Release Metadata.
- Automatic Source → Chunk evidence collection through `/v1/conversations/fetch/chunks/text`.
- Separate Retrieval / Answer / Grounding signals.
- Human Review Queue for ambiguous, weak or failed results.
- Release-to-release comparison with improved / regressed / source-changed indicators.
- Failure taxonomy for bugs: Retrieval, Generation, Grounding, Authorization/Security.
- Exportable Bug Evidence bundles with redacted Request/Response, Sources and Chunks.
- Expanded AI-for-QA guide and 50+ glossary concepts with inline links.
- Golden Dataset editor/import/export remains local to the browser; credentials are not persisted.

## Important

Use TSH/QA credentials only. Do not commit or persist Identity Tokens. The public Vercel UI may not be able to reach an internal TSH endpoint; Browser Direct or Postman may be required from the approved network.


## v2.1
- Collapsible AI-for-QA glossary.
- Added Heuristic plus project terms: Signals, non-determinism, flaky tests, thresholds, evaluator, corpus/index/metadata/provenance, RBAC/IDOR/PII leakage, direct/indirect prompt injection, Chain-of-Thought safety, idempotency, correlation ID, TTFT and clarification policy.


## v2.1
- Dashboard Coverage Map separates product components, cross-cutting test types and QA-tool self-tests.
- UI self-test renamed Console Self-Test and explicitly excluded conceptually from Product QA.
- Added Routing as a fifth AI failure category and glossary coverage for Routing, Intent Classification, Routing Accuracy, Expected/Actual Route, Component/Integration/E2E/API tests, Boundary/Negative and Test Dimension.
- Added QA guide lesson explaining E2E through Router vs isolated component testing; exact runtime routes remain an open architecture fact until observed/confirmed.
