'use strict';
// Matchmaking queue: { socketId, userId, username, elo, avatarUrl, joinedAt }
const queue   = [];
const inQueue = new Set();
const recentMatches = new Map();

const ELO_START  = 100;  // khoảng ELO ban đầu
const ELO_EXPAND = 50;   // mở rộng mỗi 30s
const ELO_MAX    = 500;  // tối đa
const TICK_MS    = 2000; // tick 2s
const MAX_WAIT_MS = 120 * 1000; // 120s timeout
const MATCH_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút không gặp lại

let ticker = null;

function joinQueue(player) {
  if (inQueue.has(player.userId)) {
    // Cập nhật socketId nếu người dùng reconnect nhưng vẫn trong queue
    const existing = queue.find(p => p.userId === player.userId);
    if (existing) existing.socketId = player.socketId;
    return false;
  }
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
    const now = Date.now();
    
    // 1. Dọn dẹp socket chết khỏi queue
    if (io && io.sockets && io.sockets.sockets) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (!io.sockets.sockets.get(queue[i].socketId)) {
          leaveQueue(queue[i].userId);
        }
      }
    }

    const matchedIds = new Set();
    const pairs = [];

    // 2. Tìm trận
    for (let i = 0; i < queue.length; i++) {
      if (matchedIds.has(queue[i].userId)) continue;
      const p = queue[i];
      
      // Auto-cancel timeout
      if (now - p.joinedAt > MAX_WAIT_MS) {
        matchedIds.add(p.userId); // Đánh dấu để xóa khỏi queue
        const s = io && io.sockets && io.sockets.sockets.get(p.socketId);
        if (s) s.emit('matchmaking_timeout', { message: 'Không tìm thấy đối thủ phù hợp. Vui lòng thử lại.' });
        continue;
      }

      const waitSecI = (now - p.joinedAt) / 1000;
      const rangeI = Math.min(ELO_START + Math.floor(waitSecI / 30) * ELO_EXPAND, ELO_MAX);
      
      let best = -1, bestDiff = Infinity;
      for (let j = i + 1; j < queue.length; j++) {
        if (matchedIds.has(queue[j].userId)) continue;
        
        // Anti-boost: cooldown cho cùng 1 cặp
        const pairKey = [p.userId, queue[j].userId].sort().join('-');
        const lastMatch = recentMatches.get(pairKey);
        if (lastMatch && now - lastMatch < MATCH_COOLDOWN_MS) continue;

        // Symmetric range check
        const waitSecJ = (now - queue[j].joinedAt) / 1000;
        const rangeJ = Math.min(ELO_START + Math.floor(waitSecJ / 30) * ELO_EXPAND, ELO_MAX);
        const effectiveRange = Math.min(rangeI, rangeJ); // Cả hai phải chấp nhận mức chênh lệch

        const diff = Math.abs(queue[j].elo - p.elo);
        if (diff <= effectiveRange && diff < bestDiff) { 
          bestDiff = diff; 
          best = j; 
        }
      }
      
      if (best !== -1) {
        matchedIds.add(queue[i].userId);
        matchedIds.add(queue[best].userId);
        pairs.push([queue[i], queue[best]]);
        
        const pairKey = [queue[i].userId, queue[best].userId].sort().join('-');
        recentMatches.set(pairKey, now);
      }
    }

    // 3. Thực thi
    for (const uid of matchedIds) leaveQueue(uid);
    for (const [p1, p2] of pairs) {
      try { onMatch(p1, p2); } catch(e) { console.error('onMatch error:', e); }
    }

    // 4. Gửi range update cho người chưa có trận
    if (io && io.sockets && io.sockets.sockets) {
      for (const p of queue) {
        const waitSec = (now - p.joinedAt) / 1000;
        const currentRange = Math.min(ELO_START + Math.floor(waitSec / 30) * ELO_EXPAND, ELO_MAX);
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit('matchmaking_range', { range: currentRange, maxRange: ELO_MAX });
      }
    }

  }, TICK_MS);
}

function getQueueSize() { return queue.length; }
function getQueue() {
  return queue.map(p => ({
    userId: p.userId,
    username: p.username,
    elo: p.elo,
    avatarUrl: p.avatarUrl || ''
  }));
}
module.exports = { joinQueue, leaveQueue, startTicker, getQueueSize, getQueue };
