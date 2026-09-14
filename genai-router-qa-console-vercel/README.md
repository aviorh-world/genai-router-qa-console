# GenAI Router QA Console v1.8

QA console for the GenAI Router / RAG project.

## v1.8

- Added **Golden Sanity / Regression** under GenAI / RAG.
- Local Golden Dataset editor: question, golden answer, must-include facts, expected source, tags and notes.
- One-click Golden run with optional isolated conversation per question and cleanup after each run.
- Captures answer similarity, must-include coverage, source match, run/version label and manual PASS/FAIL review.
- Golden Dataset import/export as JSON. Data is stored locally in the browser; credentials are never persisted.
- Added **AI for QA** guide with practical testing principles: retrieval vs generation, no-answer tests, nondeterminism, version traceability, security and human review.
- Added a full **AI QA Glossary** with 30+ terms such as RAG, Golden Dataset, Chunk, Embedding, Top-K, Grounding, Hallucination, Context Precision/Recall, LLM-as-a-Judge and Prompt Injection.
- Added inline glossary links from relevant concepts in the UI.
- Golden auto scores are explicitly advisory; final quality PASS remains a QA/SME decision until an agreed evaluator is defined.

## Important

Use TSH/QA credentials only. Do not commit or persist Identity Tokens. The public Vercel UI may not be able to reach an internal TSH endpoint; Browser Direct or Postman may be required from the approved network.
