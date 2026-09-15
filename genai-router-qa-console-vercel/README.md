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
