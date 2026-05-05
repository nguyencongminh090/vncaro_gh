'use strict';
// ── Matchmaking queue ──────────────────────────────────────────────────────
// Queue entry: { socketId, userId, username, elo, avatarUrl, joinedAt,
//               streak, recentWinRate, effectiveElo }
// effectiveElo: used ONLY for pairing — never written to DB.
const queue         = [];
const inQueue       = new Set();
const recentMatches = new Map();       // pairKey → timestamp of last match

// ── Constants ──────────────────────────────────────────────────────────────
const TICK_MS            = 2000;
const MAX_WAIT_MS        = 180 * 1000; // 3 minutes → queue_cancelled
const MATCH_COOLDOWN_MS  = 5 * 60 * 1000;
const ELO_MAX            = 500;
const EXPECTED_WIN_RATE  = 0.5;        // neutral baseline

// ── Math helpers ───────────────────────────────────────────────────────────
function sigmoid(x) {
  return 2 / (1 + Math.exp(-0.3 * x)) - 1;
}

function computeEffectiveElo(rawElo, streak, recentWinRate) {
  const streakDelta  = 50  * sigmoid(streak);
  const winRateDelta = 100 * (recentWinRate - EXPECTED_WIN_RATE);
  return rawElo + streakDelta + winRateDelta;
}

// Exponential range: 100·e^(0.02·waitSec), capped at ELO_MAX
function computeRange(waitSec) {
  return Math.min(100 * Math.exp(0.02 * waitSec), ELO_MAX);
}

// Win probability balance (0–0.5; higher = fairer)
function computeBalance(eloA, eloB) {
  const P = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  return Math.min(P, 1 - P);
}

let ticker = null;

// ── joinQueue ──────────────────────────────────────────────────────────────
function joinQueue(player) {
  if (inQueue.has(player.userId)) {
    // Reconnect: refresh socketId but keep position + timing
    const existing = queue.find(p => p.userId === player.userId);
    if (existing) existing.socketId = player.socketId;
    return false;
  }
  const effectiveElo = computeEffectiveElo(
    player.elo,
    player.streak       || 0,
    player.recentWinRate ?? 0.5
  );
  queue.push({ ...player, joinedAt: Date.now(), effectiveElo });
  inQueue.add(player.userId);
  return true;
}

// ── leaveQueue ─────────────────────────────────────────────────────────────
function leaveQueue(userId) {
  const idx = queue.findIndex(p => p.userId === userId);
  if (idx !== -1) queue.splice(idx, 1);
  inQueue.delete(userId);
}

// ── startTicker ────────────────────────────────────────────────────────────
function startTicker(io, onMatch) {
  if (ticker) return;
  ticker = setInterval(() => {
    const now = Date.now();

    // 1. Prune dead sockets
    if (io?.sockets?.sockets) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (!io.sockets.sockets.get(queue[i].socketId)) {
          leaveQueue(queue[i].userId);
        }
      }
    }

    const matchedIds = new Set();
    const pairs      = [];

    // 2. Main pairing loop
    for (let i = 0; i < queue.length; i++) {
      if (matchedIds.has(queue[i].userId)) continue;
      const p       = queue[i];
      const waitSec = (now - p.joinedAt) / 1000;

      // Auto-cancel at MAX_WAIT_MS
      if (now - p.joinedAt > MAX_WAIT_MS) {
        matchedIds.add(p.userId);
        const s = io?.sockets?.sockets?.get(p.socketId);
        if (s) s.emit('queue_cancelled', { reason: 'timeout' });
        continue;
      }

      const rangeI = computeRange(waitSec);
      let bestIdx = -1, bestScore = -Infinity;

      for (let j = i + 1; j < queue.length; j++) {
        if (matchedIds.has(queue[j].userId)) continue;

        // Anti-boost cooldown
        const pairKey  = [p.userId, queue[j].userId].sort().join('-');
        const lastTime = recentMatches.get(pairKey);
        if (lastTime && now - lastTime < MATCH_COOLDOWN_MS) continue;

        // Symmetric exponential range (stricter of the two)
        const waitSecJ = (now - queue[j].joinedAt) / 1000;
        const rangeJ   = computeRange(waitSecJ);
        const effRange = Math.min(rangeI, rangeJ);

        // Check using effectiveElo
        const diff = Math.abs(p.effectiveElo - queue[j].effectiveElo);
        if (diff > effRange) continue;

        // Win probability balance filter
        const balance = computeBalance(p.effectiveElo, queue[j].effectiveElo);
        if (balance < 0.20) continue;          // too unfair → hard reject

        // Score: reward closer matches; penalise somewhat imbalanced pairs
        let score = effRange - diff;
        if (balance < 0.40) score *= 0.5;      // soft penalty

        if (score > bestScore) { bestScore = score; bestIdx = j; }
      }

      if (bestIdx !== -1) {
        matchedIds.add(queue[i].userId);
        matchedIds.add(queue[bestIdx].userId);
        pairs.push([queue[i], queue[bestIdx]]);
        const pairKey = [queue[i].userId, queue[bestIdx].userId].sort().join('-');
        recentMatches.set(pairKey, now);
      }
    }

    // 3. Execute matched pairs (onMatch signature unchanged: p1, p2)
    for (const uid of matchedIds) leaveQueue(uid);
    for (const [p1, p2] of pairs) {
      try { onMatch(p1, p2); } catch (e) { console.error('onMatch error:', e); }
    }

    // 4. Emit queue_status to remaining (unmatched) players
    if (io?.sockets?.sockets) {
      for (const p of queue) {
        const waitSec    = (now - p.joinedAt) / 1000;
        const currRange  = computeRange(waitSec);
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit('queue_status', {
          waitSec:      Math.floor(waitSec),
          currentRange: Math.round(currRange),
          queueSize:    queue.length
        });
      }
    }

  }, TICK_MS);
}

// ── Exports ────────────────────────────────────────────────────────────────
function getQueueSize() { return queue.length; }
function getQueue() {
  return queue.map(p => ({
    userId:    p.userId,
    username:  p.username,
    elo:       p.elo,
    avatarUrl: p.avatarUrl || ''
  }));
}
module.exports = { joinQueue, leaveQueue, startTicker, getQueueSize, getQueue };
