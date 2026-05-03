const express = require('express');
const { getLeaderboard, getUserRank } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/leaderboard
router.get('/', (req, res) => {
  try {
    const { getDB } = require('../db');
    const showAll = req.query.all === '1';
    const limit = showAll ? 9999 : Math.min(parseInt(req.query.limit) || 20, 9999);
    const board = getLeaderboard(limit);
    const { total } = getDB().prepare('SELECT COUNT(*) AS total FROM users').get();
    res.json({ leaderboard: board, totalUsers: total });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// GET /api/leaderboard/me
router.get('/me', requireAuth, (req, res) => {
  try {
    const info = getUserRank(req.user.id);
    res.json({ rank: info });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

module.exports = router;
