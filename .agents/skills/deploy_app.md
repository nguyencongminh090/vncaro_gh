# Skill: Deploy App

## Objective
Validate and execute the deployment process for vncaro_gh.

## Instructions
1. Read backup.sh and confirm backup target is correct
2. Verify package.json scripts are present (start, etc.)
3. Check .env or config values are not hardcoded in server.js
4. Run: node --check server.js (syntax check only, no start)
5. Report findings. Wait for explicit user "GO" before running backup.sh or starting server