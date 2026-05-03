---
description: description: Run full pre-deploy audit and deploy validation for vncaro_gh
---

When the user types `/predeploy`, execute this sequence:

1. Act as **@reviewer** and execute the `audit_code.md` skill.
   Wait for user to type "approved" before continuing.

2. Act as **@qa** and check game.js + matchmaking.js for unhandled edge cases.
   Wait for user approval.

3. Act as **@devops** and execute the `deploy_app.md` skill.
   Do NOT run backup.sh until user types "GO".