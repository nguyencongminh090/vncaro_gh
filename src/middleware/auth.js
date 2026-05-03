const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Express middleware
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });

  req.user = payload;
  next();
}

// Socket.io middleware
function verifySocketToken(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Chưa đăng nhập'));

  const payload = verifyToken(token);
  if (!payload) return next(new Error('Phiên đăng nhập hết hạn'));

  socket.user = payload;
  next();
}

module.exports = { signToken, verifyToken, requireAuth, verifySocketToken };
