# AGENTS.md — vncaro_gh

## Project Overview
Node.js + Express web server for a Carô (Gomoku) online game platform.
Deploy target: production server via backup.sh / manual deploy.

## Stack
- Runtime: Node.js (Express)
- Frontend: Vanilla JS (`public/js/`) + CSS (`public/css/`)
- DB layer: `src/db.js`
- Auth: `src/middleware/auth.js`, `src/routes/auth.js`
- Game logic: `src/game.js`, `src/matchmaking.js`
- Entry point: `server.js`

## Key Constraints
- Do NOT modify `public/js/google-init.js` without explicit instruction
- Auth middleware must be applied before all protected routes
- ELO logic lives in `reset_elo.js` — treat as sensitive

## Preferred Workflow
1. Understand the task scope first
2. Check affected files before editing
3. Run lint/test if available before confirming done
4. Keep changes minimal and reversible

## Agent Model Preferences
- Planning / architecture: Gemini 3.1 Pro
- Code generation / review: Claude Sonnet 4.6
- Quick tasks: Gemini 3.0 Flash
- Complex debugging: Claude Opus 4.6