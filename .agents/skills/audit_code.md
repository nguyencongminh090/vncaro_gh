# Skill: Audit Code

## Objective
Review the vncaro_gh codebase for production readiness.

## Instructions
1. Read src/middleware/auth.js — check for auth bypass risks
2. Read src/routes/auth.js and src/routes/leaderboard.js — check input validation
3. Read src/game.js and src/matchmaking.js — check for unhandled edge cases
4. Read server.js — check middleware order, error handling, port config
5. Report all findings with file + line reference before making any change
6. Wait for approval before applying fixes