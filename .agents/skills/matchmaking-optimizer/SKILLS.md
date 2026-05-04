---
name: matchmaking-optimizer
description: Use this skill when the user wants to analyze, improve, or optimize 
the matchmaking/opponent-finding algorithm. Triggers on: "tìm đối thủ", "xếp trận", 
"matchmaking", "queue", "ELO matching", "optimize pairing".
---

## Goal
Analyze and improve the matchmaking algorithm for fairness, speed, and stability.

## Instructions

### Phase 1 — Profile current algorithm
- Read src/matchmaking.js fully
- Read src/game.js for match initialization logic
- Identify: queue data structure, pairing criteria, timing, edge cases

### Phase 2 — Benchmark weaknesses
Evaluate against these criteria:
1. **Fairness** — are players paired by ELO or pure FIFO?
2. **Wait time** — does ELO range expand over time if no match found?
3. **Concurrency** — is the queue safe under simultaneous join/leave?
4. **Ghost players** — are disconnected players removed from queue?
5. **Scalability** — does pairing logic degrade with large queue size?

### Phase 3 — Propose improvements
For each weakness found, propose:
- Algorithm change (e.g. ELO bracket with time-based range expansion)
- Data structure change if needed (e.g. priority queue vs array)
- Pseudocode for the proposed solution

### Phase 4 — Implement (only after user approval)
- Show full diff before applying
- Do not change socket/room logic unless directly related

## Constraints
- Phase 4 requires explicit user "approved" before writing any code
- Do not touch game.js move logic
- Preserve existing event names to avoid frontend breakage