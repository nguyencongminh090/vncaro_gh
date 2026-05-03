require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const cors     = require('cors');
const fs       = require('fs');

const { initDB }            = require('./src/db');
const authRoutes            = require('./src/routes/auth');
const leaderboardRoutes     = require('./src/routes/leaderboard');
const { verifySocketToken } = require('./src/middleware/auth');
const { setupHandlers, initMatchmaking, broadcastLiveGames, broadcastOnlineUsers } = require('./src/handlers');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 40000,       // 40s không phản hồi -> disconnect
  pingInterval: 10000,      // ping mỗi 10s để giữ kết nối
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e6,   // 1MB max payload
  transports: ['websocket', 'polling'] // ưu tiên websocket
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/api/config', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});
app.use('/api/auth',        authRoutes);
app.use('/api/leaderboard', leaderboardRoutes);


// ─── Announcement API ─────────────────────────────────────────────────────────
const { getAnnouncement, setAnnouncement } = require('./src/db');
const { verifyToken } = require('./src/middleware/auth');
const ADMIN_EMAIL = 'thayquyencaro@gmail.com';

app.get('/api/announcement', (_req, res) => {
  try { res.json(getAnnouncement() || { content: '', updated_at: null }); }
  catch(e) { res.json({ content: '', updated_at: null }); }
});

app.post('/api/announcement', (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const { findUserById } = require('./src/db');
    const user = findUserById(payload.id);
    if (!user || user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Không có quyền' });
    const { content } = req.body;
    setAnnouncement(content || '');
    io.emit('announcement', { content: content || '', updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
app.get('*', (_req, res) => {
  try {
    let html = fs.readFileSync(INDEX_PATH, 'utf8');
    html = html.replace('GOOGLE_CLIENT_ID_PLACEHOLDER', process.env.GOOGLE_CLIENT_ID || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Server error'); }
});

initDB();

io.use(verifySocketToken);
io.on('connection', (socket) => {
  console.log(`✅ ${socket.user.username}`);
  setupHandlers(io, socket);
  const bc = () => io.emit('online_count', { count: io.sockets.sockets.size });
  bc();
  // Send current state to new connection
  const { waitingRooms, games } = require('./src/game');
  const rooms = {};
  for (const [code, room] of waitingRooms) {
    rooms[code] = { username: room.host.username, locked: room.locked || false };
  }
  socket.emit('rooms_update', rooms);
  // Send live games
  broadcastLiveGames(io);

  // Broadcast online users list
  broadcastOnlineUsers(io);

  socket.on('disconnect', () => {
    console.log(`❌ ${socket.user.username}`);
    bc();
    broadcastOnlineUsers(io);
  });
});

initMatchmaking(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮  VNCaro http://localhost:${PORT}\n`);
});
