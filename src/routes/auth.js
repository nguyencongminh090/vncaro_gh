'use strict';
const express = require('express');
const { createUser, findUserById, getUserRank, getDB, updateAvatarUrl } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const router = express.Router();

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Thiếu credential' });
    const GCID = process.env.GOOGLE_CLIENT_ID;
    if (!GCID) return res.status(503).json({
      error: 'Google OAuth chưa cấu hình. Thêm GOOGLE_CLIENT_ID vào .env'
    });

    const parts = credential.split('.');
    if (parts.length !== 3) return res.status(400).json({ error: 'Credential không hợp lệ' });
    const b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));

    if (payload.aud !== GCID) return res.status(401).json({ error: 'Client ID không khớp' });
    if (payload.exp < Date.now()/1000) return res.status(401).json({ error: 'Token hết hạn' });

    const googleId = payload.sub;
    const googleName = (payload.name || payload.email.split('@')[0]).trim();
    const avatarUrl = payload.picture || ''; // Google profile picture URL

    const GOOGLE_HASH = 'GOOGLE:' + googleId;
    const db = getDB();
    let user = db.prepare('SELECT * FROM users WHERE password_hash = ?').get(GOOGLE_HASH);

    if (!user) {
      // New user - create with Vietnamese name and avatar
      let uname = googleName.substring(0, 50);
      let attempt = uname; let n = 1;
      while (db.prepare('SELECT id FROM users WHERE username = ?').get(attempt)) {
        attempt = uname.substring(0, 46) + '_' + n++;
      }
      const id = createUser(attempt, GOOGLE_HASH, avatarUrl);
      // Đảm bảo ELO mặc định là 1200
      db.prepare('UPDATE users SET elo=1200 WHERE id=? AND elo < 1200').run(id);
      // Lưu email
      try { db.prepare('UPDATE users SET email=? WHERE id=?').run(email, id); } catch(e) {}
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    } else {
      // Existing user: update name and avatar from Google
      const newName = googleName.substring(0, 50);
      const taken = db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(newName, user.id);
      if (!taken && user.username !== newName) {
        db.prepare('UPDATE users SET username=? WHERE id=?').run(newName, user.id);
      }
      // Always update avatar
      if (avatarUrl) {
        db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl, user.id);
      }
      user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    }

    const token = signToken({ id: user.id, username: user.username });
    res.json({
      token,
      user: {
        id: user.id, username: user.username, elo: user.elo,
        wins: user.wins, losses: user.losses, draws: user.draws,
        avatarUrl: user.avatar_url || ''
      }
    });
  } catch(e) {
    console.error('Google auth error:', e);
    res.status(500).json({ error: 'Lỗi xác thực: ' + e.message });
  }
});

router.post('/login', async (req, res) => {
  const bcrypt = require('bcryptjs');
  try {
    const { username, password } = req.body;
    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user) return res.status(401).json({ error: 'Sai tên hoặc mật khẩu' });
    if (user.password_hash.startsWith('GOOGLE:')) return res.status(401).json({ error: 'Tài khoản dùng Google đăng nhập' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Sai tên hoặc mật khẩu' });
    const token = signToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username, elo: user.elo, wins: user.wins, losses: user.losses, draws: user.draws, avatarUrl: user.avatar_url || '' } });
  } catch(e) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

router.get('/me', requireAuth, (req, res) => {
  try {
    const info = getUserRank(req.user.id);
    if (!info) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json({ user: { ...info, avatarUrl: info.avatar_url || '' } });
  } catch(e) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});
router.post('/dev', async (req, res) => {
  if (process.env.DEV_MODE !== 'true') return res.status(403).json({ error: 'Dev mode disabled' });
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username' });
    const db = getDB();
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      const id = createUser(username, 'DEV_MODE_ACCOUNT', '');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }
    const token = signToken({ id: user.id, username: user.username });
    res.json({
      token,
      user: {
        id: user.id, username: user.username, elo: user.elo,
        wins: user.wins, losses: user.losses, draws: user.draws,
        avatarUrl: user.avatar_url || ''
      }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
