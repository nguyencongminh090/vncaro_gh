'use strict';
// Script chạy 1 lần để reset dữ liệu
const { getDB, initDB } = require('./src/db');

initDB();
const db = getDB();

// Reset tất cả ELO về 1200, W/L/D về 0
const result = db.prepare(`
  UPDATE users SET 
    elo = 1200, 
    wins = 0, 
    losses = 0, 
    draws = 0, 
    total_ranked_games = 0
`).run();

console.log(`✅ Reset ${result.changes} tài khoản về ELO 1200, W=0 L=0 D=0`);
process.exit(0);
