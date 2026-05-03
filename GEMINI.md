# vncaro_gh — Antigravity Rules

## Stack
- Node.js + Express, entry: server.js
- DB: src/db.js
- Auth: src/middleware/auth.js, src/routes/auth.js
- Game logic: src/game.js, src/matchmaking.js
- Frontend: public/js/ (vanilla JS), public/css/

## Rules
- Always read affected files before editing
- Do NOT modify public/js/google-init.js without explicit instruction
- Treat reset_elo.js as sensitive — ask before any change
- Require my confirmation before any deploy or DB operation
- Keep changes minimal and reversible
