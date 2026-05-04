---
name: bug-hunter
description: Use this skill when the user reports a runtime bug, unexpected behavior, 
false event triggers, or socket/state issues. Triggers on: "bug", "lỗi", "fix", 
"sai", "nhầm", "false trigger", "race condition".
---

## Goal
Investigate and fix backend bugs with minimal, safe, targeted changes.

## Instructions

### Phase 1 — Investigate (DO NOT FIX YET)
- Read all affected files fully before forming any hypothesis
- Trace the full event lifecycle: client emit → server handler → response
- Look for: missing state guards, race conditions, wrong event scope
- Report findings as: FILE → LINE → ROOT CAUSE → WHY IT HAPPENS
- Wait for user confirmation before Phase 2

### Phase 2 — Fix
- Apply minimal change only
- Show diff before applying
- Add state guard/flag if logic depends on player state
- Do not refactor unrelated code

### Phase 3 — Verify  
- Re-read all modified files
- Confirm original bug is resolved
- Confirm no regression on adjacent logic

## Constraints
- Never fix in Phase 1
- Never modify more than necessary
- Always show diff before applying any change