# Commands

## Template safety (once per new repo clone)
- Enable template guard hook: `git config core.hooksPath .githooks`
- Bypass once (if needed): `SKIP_TEMPLATE_GUARD=1 git commit -m "..."`.

## Install
- `npm install`

## Run
- Frontend only: `npm run dev`
- Vercel-style full stack: `npm run dev:vercel`
- Local server secret: set `OPENAI_API_KEY` in your shell or `.env.local` before running the Vercel dev command

## Test
- `npm run check`
- `npm run build`

## Lint/Format
- No formatter or linter configured yet.
