'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'vncaro.db');
let db;

function getDB() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA wal_autocheckpoint = 100');
  }
  return db;
}

function initDB() {
  const d = getDB();
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      elo INTEGER DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      total_ranked_games INTEGER DEFAULT 0,
      avatar_url TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT,
      game_type TEXT DEFAULT 'ranked',
      player1_id INTEGER NOT NULL,
      player2_id INTEGER NOT NULL,
      winner_id INTEGER,
      draw INTEGER DEFAULT 0,
      p1_elo_before INTEGER, p2_elo_before INTEGER,
      p1_elo_after INTEGER, p2_elo_after INTEGER,
      total_moves INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
  `);
  // Migrations for existing DBs
  const migrations = [
    "ALTER TABLE users ADD COLUMN total_ranked_games INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''",
    "ALTER TABLE games ADD COLUMN game_type TEXT DEFAULT 'ranked'",
  ];
  migrations.forEach(sql => { try { d.exec(sql); } catch(e) {} });
  // Thêm cột email nếu chưa có (migration)
  try { d.exec('ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL'); } catch(e) {}

  // NOTE: Không reset ELO hàng loạt ở đây - chỉ fix lần đầu qua migrate.js
  // Trigger đảm bảo mọi user mới luôn có ELO >= 1200
  try {
    // Bảng thông báo (chỉ admin thayquyencaro@gmail.com quản lý)
  d.exec(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Tạo thông báo mặc định nếu chưa có
  const ann = d.prepare('SELECT id FROM announcements LIMIT 1').get();
  if (!ann) d.prepare("INSERT INTO announcements (content) VALUES ('')").run();

  // Trigger: user mới mặc định ELO >= 1200 khi tạo tài khoản
  d.exec(
      'CREATE TRIGGER IF NOT EXISTS enforce_min_elo ' +
      'AFTER INSERT ON users BEGIN ' +
      'UPDATE users SET elo=1200 WHERE id=NEW.id AND elo < 1200; ' +
      'END'
    );
  } catch(e) {}
  // Reset W/L/D về 0 cho tất cả (chạy khi cần)
  // d.prepare("UPDATE users SET wins=0,losses=0,draws=0,total_ranked_games=0").run();
  try { d.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch(e) {}
  console.log('Database khởi tạo thành công');
}

function createUser(username, passwordHash, avatarUrl) {
  const r = getDB().prepare(
    'INSERT INTO users (username, password_hash, avatar_url) VALUES (?, ?, ?)'
  ).run(username, passwordHash, avatarUrl || '');
  return r.lastInsertRowid;
}

function findUserByUsername(username) {
  return getDB().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findUserById(id) {
  return getDB().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function updateUserStats(userId, { eloDelta, result, gameType }) {
  const isRanked = gameType === 'ranked';
  // W/L/D chỉ ghi nhận cho trận Thi đấu (ranked)
  if (isRanked) {
    let w=0, l=0, dr=0;
    if (result === 'win') w = 1;
    else if (result === 'loss') l = 1;
    else dr = 1;
    getDB().prepare(`
      UPDATE users SET elo=MAX(100,elo+?), wins=wins+?, losses=losses+?,
      draws=draws+?, total_ranked_games=total_ranked_games+1 WHERE id=?
    `).run(eloDelta, w, l, dr, userId);
  }
  // Casual: không thay đổi gì cả (không ELO, không W/L/D)
}

function updateAvatarUrl(userId, avatarUrl) {
  getDB().prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl || '', userId);
}

function getLeaderboard(limit = 50) {
  return getDB().prepare(`
    SELECT id, username, avatar_url, elo, wins, losses, draws, total_ranked_games,
           (wins+losses+draws) AS total_games
    FROM users ORDER BY elo DESC, wins DESC LIMIT ?
  `).all(limit);
}

function getUserRank(userId) {
  const d = getDB();
  const user = d.prepare(`
    SELECT id, username, avatar_url, elo, wins, losses, draws, total_ranked_games,
           (wins+losses+draws) AS total_games
    FROM users WHERE id=?
  `).get(userId);
  if (!user) return null;
  const { rank } = d.prepare('SELECT COUNT(*) AS rank FROM users WHERE elo > ? OR (elo = ? AND id < ?)').get(user.elo, user.elo, user.id);
  const { total } = d.prepare('SELECT COUNT(*) AS total FROM users').get();
  return { ...user, rank: rank + 1, totalUsers: total };
}

function saveGame({ roomCode, gameType, player1Id, player2Id, winnerId, draw,
  p1EloBefore, p2EloBefore, p1EloAfter, p2EloAfter, totalMoves }) {
  getDB().prepare(`
    INSERT INTO games (room_code,game_type,player1_id,player2_id,winner_id,draw,
    p1_elo_before,p2_elo_before,p1_elo_after,p2_elo_after,total_moves)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(roomCode, gameType||'ranked', player1Id, player2Id, winnerId??null, draw?1:0,
    p1EloBefore, p2EloBefore, p1EloAfter, p2EloAfter, totalMoves);
}

// Chess.com K-factor (chính xác)
// - K=40: dưới 30 trận rated (người mới)
// - K=20: từ 30 trận trở lên và ELO < 2400
// - K=10: ELO >= 2400 (cao thủ)
function getKFactor(elo, totalGames) {
  if (totalGames < 30) return 40;
  if (elo >= 2400) return 10;
  return 20;
}

function calcELO(winnerElo, loserElo, winnerGames, loserGames) {
  const Kw = getKFactor(winnerElo, winnerGames || 0);
  const Kl = getKFactor(loserElo, loserGames || 0);
  const expW = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  return {
    winnerDelta: Math.round(Kw * (1 - expW)),
    loserDelta:  Math.round(Kl * (0 - (1 - expW)))
  };
}

function calcELODraw(elo1, elo2, games1, games2) {
  const K1 = getKFactor(elo1, games1 || 0);
  const K2 = getKFactor(elo2, games2 || 0);
  const exp1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
  return {
    delta1: Math.round(K1 * (0.5 - exp1)),
    delta2: Math.round(K2 * (0.5 - (1 - exp1)))
  };
}

function getAnnouncement() {
  return getDB().prepare('SELECT content, updated_at FROM announcements LIMIT 1').get();
}
function setAnnouncement(content) {
  getDB().prepare('UPDATE announcements SET content=?, updated_at=CURRENT_TIMESTAMP').run(content);
}

module.exports = {
  initDB, getDB, createUser, findUserByUsername, findUserById,
  updateUserStats, updateAvatarUrl,
  getLeaderboard, getUserRank, saveGame,
  calcELO, calcELODraw, getKFactor,
  getAnnouncement, setAnnouncement
};
