## 2026-04-23

- Problem: `npm run check` initially failed because TypeScript could not resolve the side-effect CSS import in `src/main.tsx`.
- Fix: added `src/vite-env.d.ts` with `/// <reference types="vite/client" />`.
- Status: resolved.

- Problem: intake-form pastes exported as question blocks were parsed badly because `src/triage.ts` only handled `Label: value` lines and also let question/help text contaminate routing heuristics.
- Fix: added question-block extraction, helper-text skipping, stronger question-boundary detection, and answer-only analysis text before recommendation logic runs.
- Status: resolved for the tested sample; still heuristic and should be tested against more real requests.

- Problem: heuristics alone were still too brittle for inconsistent human-written intake answers and mixed prompt/answer text.
- Fix: added a second analysis path that sends the pasted form to the OpenAI Responses API with `gpt-5.4-mini` and a strict JSON schema, then hydrates the same editable workspace in the app.
- Status: implemented and compiled; live behavior still depends on a valid local API key and should be tested with real requests.

- Problem: the first LLM integration put the OpenAI key in the browser, which is not suitable for deployment.
- Fix: moved the model call into `api/analyze.ts`, shared the schema/prompt config between client and server, and switched local/deployment setup to `OPENAI_API_KEY` on the server side.
- Status: resolved for architecture; local full-stack testing via `vercel dev` still requires Vercel CLI login on this machine.
