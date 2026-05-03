'use strict';
// Matchmaking queue: { socketId, userId, username, elo, avatarUrl, joinedAt }
const queue   = [];
const inQueue = new Set();

const ELO_START  = 100;  // khoảng ELO ban đầu
const ELO_EXPAND = 50;   // mở rộng mỗi 30s
const ELO_MAX    = 500;  // tối đa
const TICK_MS    = 2000; // tick 2s

let ticker = null;

function joinQueue(player) {
  if (inQueue.has(player.userId)) return false;
  queue.push({ ...player, joinedAt: Date.now() });
  inQueue.add(player.userId);
  return true;
}

function leaveQueue(userId) {
  const idx = queue.findIndex(p => p.userId === userId);
  if (idx !== -1) queue.splice(idx, 1);
  inQueue.delete(userId);
}

function startTicker(io, onMatch) {
  if (ticker) return;
  ticker = setInterval(() => {
    // ── Điều kiện ẩn: chỉ ghép trận khi có >= 3 unique users online ──────────
    // Mục đích: ngăn buff ELO bằng 2 tài khoản trong khung giờ vắng
    const onlineUsers = new Set();
    if (io && io.sockets && io.sockets.sockets) {
      io.sockets.sockets.forEach(s => { if (s.user && s.user.id) onlineUsers.add(s.user.id); });
    }
    if (onlineUsers.size < 4) return; // Âm thầm bỏ qua, không thông báo

    // Collect matched pairs FIRST, then remove from queue
    const matchedIds = new Set();
    const pairs = [];

    for (let i = 0; i < queue.length; i++) {
      if (matchedIds.has(queue[i].userId)) continue;
      const p  = queue[i];
      const waitSec = (Date.now() - p.joinedAt) / 1000;
      const range = Math.min(ELO_START + Math.floor(waitSec / 30) * ELO_EXPAND, ELO_MAX);
      let best = -1, bestDiff = Infinity;
      for (let j = i + 1; j < queue.length; j++) {
        if (matchedIds.has(queue[j].userId)) continue;
        const diff = Math.abs(queue[j].elo - p.elo);
        if (diff <= range && diff < bestDiff) { bestDiff = diff; best = j; }
      }
      if (best !== -1) {
        matchedIds.add(queue[i].userId);
        matchedIds.add(queue[best].userId);
        pairs.push([queue[i], queue[best]]);
      }
    }

    for (const uid of matchedIds) leaveQueue(uid);
    for (const [p1, p2] of pairs) {
      try { onMatch(p1, p2); } catch(e) { console.error('onMatch error:', e); }
    }
  }, TICK_MS);
}

function getQueueSize() { return queue.length; }
module.exports = { joinQueue, leaveQueue, startTicker, getQueueSize };
