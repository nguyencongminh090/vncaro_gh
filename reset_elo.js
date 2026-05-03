'use strict';
// Script reset ELO - chạy 1 lần trên server
require('dotenv').config();
const { getDB, initDB } = require('./src/db');

initDB();
const db = getDB();

// Reset tất cả về 1200, W/L/D về 0
const r1 = db.prepare("UPDATE users SET elo=1200, wins=0, losses=0, draws=0, total_ranked_games=0").run();
console.log(`✅ Reset ${r1.changes} tài khoản về ELO 1200`);

// Kiểm tra lại
const users = db.prepare("SELECT username, elo FROM users ORDER BY elo DESC LIMIT 10").all();
console.log("Danh sách sau reset:");
users.forEach(u => console.log(`  ${u.username}: ELO ${u.elo}`));
process.exit(0);
