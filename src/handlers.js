'use strict';
const {
  games, waitingRooms,
  createGame, getGame, deleteGame,
  isForbidden, checkWinner, checkDraw,
  generateRoomCode, MOVE_TIME, BOARD_SIZE
} = require('./game');
const {
  findUserById, updateUserStats, saveGame,
  calcELO, calcELODraw,
  getUserRank, getAnnouncement, setAnnouncement
} = require('./db');
const { joinQueue, leaveQueue, startTicker, getQueueSize } = require('./matchmaking');

const DISCONNECT_GRACE = 30000; // 30s để mobile reconnect
const disconnectTimers = new Map();

// ── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcastRooms(io) {
  const rooms = {};
  for (const [code, room] of waitingRooms) {
    rooms[code] = {
      code,
      username: room.host.username,
      avatarUrl: room.host.avatarUrl || '',
      locked: room.locked || false
    };
  }
  io.emit('rooms_update', rooms);
}

function broadcastLiveGames(io) {
  const live = [];
  for (const [code, game] of games) {
    if (game.status === 'playing') {
      live.push({
        roomCode: code,
        gameType: game.gameType || 'ranked',
        playerX: (() => {
          const u = findUserById(game.players.X.userId);
          const r = getUserRank(game.players.X.userId);
          return { userId: game.players.X.userId, username: game.players.X.username,
            elo: game.players.X.elo, avatarUrl: game.players.X.avatarUrl || '',
            rank: r ? r.rank : null, wins: u ? u.wins : 0, losses: u ? u.losses : 0, draws: u ? u.draws : 0 };
        })(),
        playerO: (() => {
          const u = findUserById(game.players.O.userId);
          const r = getUserRank(game.players.O.userId);
          return { userId: game.players.O.userId, username: game.players.O.username,
            elo: game.players.O.elo, avatarUrl: game.players.O.avatarUrl || '',
            rank: r ? r.rank : null, wins: u ? u.wins : 0, losses: u ? u.losses : 0, draws: u ? u.draws : 0 };
        })(),
        moveCount: game.moveCount,
        spectatorCount: getSpectatorCount(code)
      });
    }
  }
  io.emit('live_games', live);
}

function getSpectatorCount(roomCode) {
  const room = io_ref?.sockets?.adapter?.rooms?.get(roomCode);
  if (!room) return 0;
  let count = 0;
  room.forEach(sid => {
    const s = io_ref?.sockets?.sockets?.get(sid);
    if (s && s.isSpectator) count++;
  });
  return count;
}


function broadcastViewers(io, roomCode) {
  const game = games.get ? games.get(roomCode) : null;
  // Use getGame
  const g = require('./game').getGame(roomCode);
  if (!g) return;
  const roomSockets = io.sockets.adapter.rooms.get(roomCode);
  if (!roomSockets) return;

  const spectators = [];
  roomSockets.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s && s.isSpectator) {
      spectators.push({
        username: s.user?.username || '?',
        avatarUrl: s.user?.avatarUrl || ''
      });
    }
  });

  io.to(roomCode).emit('viewers_update', {
    players: {
      X: { userId: g.players.X.userId, username: g.players.X.username, avatarUrl: g.players.X.avatarUrl || '' },
      O: { userId: g.players.O.userId, username: g.players.O.username, avatarUrl: g.players.O.avatarUrl || '' }
    },
    spectators
  });
}


// Broadcast danh sách users đang online (có socket kết nối)
function broadcastOnlineUsers(io) {
  const seen = new Set();
  const unique = [];
  io.sockets.sockets.forEach(s => {
    if (!s.user || seen.has(s.user.id)) return;
    seen.add(s.user.id);
    // Lấy avatar từ DB để luôn mới nhất
    const dbUser = findUserById(s.user.id);
    unique.push({
      userId: s.user.id,
      username: s.user.username,
      avatarUrl: dbUser?.avatar_url || ''
    });
  });
  io.emit('online_users', unique);
}

let io_ref = null;

function setupHandlers(io, socket) {
  io_ref = io;
  const { id: userId, username } = socket.user;
  socket.currentRoom = null;
  socket.isSpectator = false;
  // Enrich socket.user với avatarUrl mới nhất từ DB
  const _u = findUserById(userId);
  socket.user.avatarUrl = _u?.avatar_url || '';

  function freshUser() {
    return findUserById(userId) || { elo: 1200, total_ranked_games: 0, avatar_url: '' };
  }

  function cancelDisconnectTimer() {
    const key = `user_${userId}`;
    if (disconnectTimers.has(key)) {
      clearTimeout(disconnectTimers.get(key));
      disconnectTimers.delete(key);
    }
  }

  function startMoveTimer(roomCode) {
    const game = getGame(roomCode);
    if (!game) return;
    if (game.timer) clearInterval(game.timer);
    game.timeLeft = MOVE_TIME;
    io.to(roomCode).emit('timer', { roomCode, timeLeft: game.timeLeft });
    game.timer = setInterval(() => {
      game.timeLeft--;
      io.to(roomCode).emit('timer', { roomCode, timeLeft: game.timeLeft });
      if (game.timeLeft <= 0) {
        clearInterval(game.timer); game.timer = null;
        endGame(roomCode, game.currentTurn === 'X' ? 'O' : 'X', 'timeout');
      }
    }, 1000);
  }

  function endGame(roomCode, winnerPiece, reason) {
    const game = getGame(roomCode);
    if (!game || game.status !== 'playing') return;
    game.status = 'finished';
    if (game.timer) { clearInterval(game.timer); game.timer = null; }

    const isDraw = winnerPiece === null;
    const p = game.players;
    const isRanked = game.gameType === 'ranked';
    const u1 = findUserById(p.X.userId) || { elo: p.X.elo, total_ranked_games: 0 };
    const u2 = findUserById(p.O.userId) || { elo: p.O.elo, total_ranked_games: 0 };
    const elo1B = u1.elo, elo2B = u2.elo;
    const g1 = u1.total_ranked_games || 0, g2 = u2.total_ranked_games || 0;
    let xDelta = 0, oDelta = 0;

    if (isRanked) {
      if (isDraw) {
        const { delta1, delta2 } = calcELODraw(elo1B, elo2B, g1, g2);
        xDelta = delta1; oDelta = delta2;
        updateUserStats(p.X.userId, { eloDelta: delta1, result: 'draw', gameType: 'ranked' });
        updateUserStats(p.O.userId, { eloDelta: delta2, result: 'draw', gameType: 'ranked' });
      } else {
        const isXWin = winnerPiece === 'X';
        const { winnerDelta, loserDelta } = calcELO(
          isXWin ? elo1B : elo2B, isXWin ? elo2B : elo1B,
          isXWin ? g1 : g2, isXWin ? g2 : g1
        );
        xDelta = isXWin ? winnerDelta : loserDelta;
        oDelta = isXWin ? loserDelta : winnerDelta;
        updateUserStats(p.X.userId, { eloDelta: xDelta, result: isXWin ? 'win' : 'loss', gameType: 'ranked' });
        updateUserStats(p.O.userId, { eloDelta: oDelta, result: isXWin ? 'loss' : 'win', gameType: 'ranked' });
      }
    } else {
      // Casual: no ELO change, just W/L/D stats
      if (isDraw) {
        updateUserStats(p.X.userId, { eloDelta: 0, result: 'draw', gameType: 'casual' });
        updateUserStats(p.O.userId, { eloDelta: 0, result: 'draw', gameType: 'casual' });
      } else {
        const isXWin = winnerPiece === 'X';
        updateUserStats(p.X.userId, { eloDelta: 0, result: isXWin ? 'win' : 'loss', gameType: 'casual' });
        updateUserStats(p.O.userId, { eloDelta: 0, result: isXWin ? 'loss' : 'win', gameType: 'casual' });
      }
    }

    saveGame({
      roomCode, gameType: game.gameType || 'ranked',
      player1Id: p.X.userId, player2Id: p.O.userId,
      winnerId: isDraw ? null : (winnerPiece === 'X' ? p.X.userId : p.O.userId),
      draw: isDraw,
      p1EloBefore: elo1B, p2EloBefore: elo2B,
      p1EloAfter: elo1B + xDelta, p2EloAfter: elo2B + oDelta,
      totalMoves: game.moveCount
    });

    const eloChanges = isRanked ? {
      [p.X.userId]: { delta: xDelta, newElo: elo1B + xDelta },
      [p.O.userId]: { delta: oDelta, newElo: elo2B + oDelta }
    } : {};

    // Tính casual scores trên server để broadcast cho spectator
    let newCasualScores = { ...(game.casualScores || {}) };
    if (game.gameType === 'casual') {
      if (isDraw) {
        newCasualScores[p.X.userId] = (newCasualScores[p.X.userId] || 0) + 1;
        newCasualScores[p.O.userId] = (newCasualScores[p.O.userId] || 0) + 1;
      } else {
        const winUid = winnerPiece === 'X' ? p.X.userId : p.O.userId;
        newCasualScores[winUid] = (newCasualScores[winUid] || 0) + 1;
      }
    }

    io.to(roomCode).emit('game_over', {
      reason, draw: isDraw, gameType: game.gameType,
      winner: isDraw ? null : {
        userId: winnerPiece === 'X' ? p.X.userId : p.O.userId,
        username: winnerPiece === 'X' ? p.X.username : p.O.username
      },
      eloChanges,
      casualScores: newCasualScores  // broadcast scores mới nhất
    });

    // Keep room data for casual rematch
    if (game.gameType === 'casual') {
      game.status = 'finished_casual';
      game.casualScores = newCasualScores; // lưu vào game
      game.lastPlayerX = { ...p.X };
      game.lastPlayerO = { ...p.O };
    } else {
      deleteGame(roomCode);
    }
    broadcastLiveGames(io);
  }

  function startGameInRoom(roomCode, playerX, playerO, gameType) {
    const game = createGame(roomCode, playerX, playerO);
    game.gameType = gameType || 'casual';
    game.player1Id = playerX.userId; // người trái cố định suốt session
    waitingRooms.delete(roomCode);
    const startData = {
      roomCode, gameType: game.gameType,
      isRematch: false,
      board: game.board, forbidden: game.forbidden,
      players: {
        X: { userId: playerX.userId, username: playerX.username, elo: playerX.elo, avatarUrl: playerX.avatarUrl || '' },
        O: { userId: playerO.userId, username: playerO.username, elo: playerO.elo, avatarUrl: playerO.avatarUrl || '' }
      },
      currentTurn: 'X',
      moveCount: 0
    };
    io.to(roomCode).emit('game_start', startData);
    broadcastRooms(io);
    broadcastLiveGames(io);
    startMoveTimer(roomCode);
    setTimeout(() => broadcastViewers(io, roomCode), 200);
  }

  function leaveCurrentRoom(permanent = false) {
    const room = socket.currentRoom;
    if (!room) return;
    if (socket.isSpectator) {
      socket.leave(room);
      socket.currentRoom = null;
      socket.isSpectator = false;
      broadcastLiveGames(io);
      if (room) setTimeout(() => broadcastViewers(io, room), 100);
      return;
    }
    if (waitingRooms.has(room)) {
      waitingRooms.delete(room);
      broadcastRooms(io);
    }
    const game = getGame(room);
    if (game && game.status === 'playing' && permanent) {
      const leftPiece = game.players.X.userId === userId ? 'X' : 'O';
      endGame(room, leftPiece === 'X' ? 'O' : 'X', 'disconnect');
    } else if (game && game.status === 'finished_casual' && permanent) {
      // Dọn dẹp game casual đã kết thúc khi người chơi rời
      deleteGame(room);
      broadcastLiveGames(io);
    }
    socket.leave(room);
    socket.currentRoom = null;
  }

  // ── Watch game ─────────────────────────────────────────────────────────────
  socket.on('watch_game', ({ roomCode }) => {
    try {
      const game = getGame(roomCode);
      if (!game || (game.status !== 'playing' && game.status !== 'finished_casual')) {
        return socket.emit('room_error', { message: 'Trận đấu không tồn tại' });
      }
      // Fix #2: Leave matchmaking queue when spectating — user must not be matched
      // while subscribed to another room's event stream.
      leaveQueue(userId);
      if (socket.currentRoom) leaveCurrentRoom(false);
      socket.join(roomCode);
      socket.currentRoom = roomCode;
      socket.isSpectator = true;
      socket.emit('game_start', {
        roomCode, gameType: game.gameType,
        board: game.board, forbidden: game.forbidden,
        players: {
          X: { userId: game.players.X.userId, username: game.players.X.username, elo: game.players.X.elo, avatarUrl: game.players.X.avatarUrl || '' },
          O: { userId: game.players.O.userId, username: game.players.O.username, elo: game.players.O.elo, avatarUrl: game.players.O.avatarUrl || '' }
        },
        currentTurn: game.currentTurn,
        moveCount: game.moveCount || 0,
        isSpectator: true,
        isRematch: !!(game.displayLeft), // nếu có displayLeft = đang ở rematch
        casualScores: game.casualScores || {},
        displayLeft:  game.displayLeft  || null,
        displayRight: game.displayRight || null
      });
      if (game.timeLeft) socket.emit('timer', { timeLeft: game.timeLeft });
      broadcastLiveGames(io);
      // Broadcast updated viewers list to everyone in room
      setTimeout(() => broadcastViewers(io, roomCode), 150);
    } catch(e) { console.error('watch_game:', e); }
  });

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on('create_room', ({ password } = {}) => {
    try {
      leaveCurrentRoom(false);
      const code = generateRoomCode();
      const u = freshUser();
      waitingRooms.set(code, {
        code,
        locked: !!(password && password.trim()),
        password: (password || '').trim(),
        host: {
          socketId: socket.id, userId, username,
          elo: u.elo, avatarUrl: u.avatar_url || ''
        }
      });
      socket.join(code);
      socket.currentRoom = code;
      socket.emit('room_created', { roomCode: code });
      broadcastRooms(io);
    } catch(e) { socket.emit('room_error', { message: 'Không thể tạo phòng' }); }
  });

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, password } = {}) => {
    try {
      const code = (roomCode || '').toUpperCase().trim();
      const waiting = waitingRooms.get(code);
      if (!waiting) return socket.emit('room_error', { message: 'Mã phòng không tồn tại' });
      if (waiting.host.userId === userId) return socket.emit('room_error', { message: 'Không thể tự vào phòng của mình' });
      // Check password
      if (waiting.locked && waiting.password !== (password || '').trim()) {
        return socket.emit('room_error', { message: 'Sai mật khẩu phòng' });
      }
      leaveCurrentRoom(false);
      const u = freshUser();
      socket.join(code);
      socket.currentRoom = code;
      socket.isSpectator = false;
      const coinFlip = Math.random() < 0.5;
      const guest = { socketId: socket.id, userId, username, elo: u.elo, avatarUrl: u.avatar_url || '' };
      const playerX = coinFlip ? waiting.host : guest;
      const playerO = coinFlip ? guest : waiting.host;
      startGameInRoom(code, playerX, playerO, 'casual');
    } catch(e) { socket.emit('room_error', { message: 'Lỗi khi vào phòng' }); }
  });

  // ── Rejoin game ────────────────────────────────────────────────────────────
  socket.on('rejoin_game', ({ roomCode }) => {
    try {
      const code = (roomCode || '').toUpperCase().trim();
      const game = getGame(code);
      if (!game || (game.status !== 'playing')) {
        return socket.emit('room_error', { message: 'Trận đấu đã kết thúc' });
      }
      const isPX = game.players.X.userId === userId;
      const isPO = game.players.O.userId === userId;
      if (!isPX && !isPO) return socket.emit('room_error', { message: 'Bạn không tham gia trận này' });
      cancelDisconnectTimer();
      if (isPX) game.players.X.socketId = socket.id;
      if (isPO) game.players.O.socketId = socket.id;
      if (socket.currentRoom !== code) {
        if (socket.currentRoom) socket.leave(socket.currentRoom);
        socket.join(code);
        socket.currentRoom = code;
      }
      socket.isSpectator = false;
      socket.emit('game_start', {
        roomCode: code, gameType: game.gameType || 'ranked',
        board: game.board, forbidden: game.forbidden,
        players: {
          X: { userId: game.players.X.userId, username: game.players.X.username, elo: game.players.X.elo, avatarUrl: game.players.X.avatarUrl || '' },
          O: { userId: game.players.O.userId, username: game.players.O.username, elo: game.players.O.elo, avatarUrl: game.players.O.avatarUrl || '' }
        },
        currentTurn: game.currentTurn,
        moveCount: game.moveCount || 0
      });
      socket.emit('timer', { timeLeft: game.timeLeft || MOVE_TIME });
    } catch(e) { socket.emit('room_error', { message: 'Lỗi khi quay lại trận' }); }
  });

  // ── Casual rematch ─────────────────────────────────────────────────────────
  socket.on('casual_rematch', ({ roomCode }) => {
    try {
      const game = getGame(roomCode);
      if (!game || game.status !== 'finished_casual') return;
      // Only players can request rematch
      const isPlayer = game.lastPlayerX?.userId === userId || game.lastPlayerO?.userId === userId;
      if (!isPlayer) return;

      // Track rematch votes
      if (!game.rematchVotes) game.rematchVotes = new Set();
      game.rematchVotes.add(userId);

      // Notify room about vote
      io.to(roomCode).emit('rematch_vote', {
        userId, username,
        count: game.rematchVotes.size
      });

      // Both players voted → start rematch
      if (game.rematchVotes.size >= 2) {
        game.rematchVotes.clear();
        const wasX = game.lastPlayerX;
        const wasO = game.lastPlayerO;
        const p1Id = game.player1Id; // người trái cố định từ ván đầu

        // Người đi O ván trước sẽ đi X ván này
        const newX = wasO;
        const newO = wasX;
        deleteGame(roomCode);

        const newGame = createGame(roomCode, newX, newO);
        newGame.gameType = 'casual';
        newGame.player1Id = p1Id;
        newGame.casualScores = game.casualScores || {}; // kế thừa tỉ số

        // Xác định piece của từng vị trí dựa trên player1Id cố định
        const leftPiece  = newX.userId === p1Id ? 'X' : 'O';
        const rightPiece = newX.userId === p1Id ? 'O' : 'X';
        const leftUserId  = p1Id;
        const rightUserId = (newX.userId === p1Id ? newO.userId : newX.userId);

        const startData = {
          roomCode, gameType: 'casual', isRematch: true,
          board: newGame.board, forbidden: newGame.forbidden,
          players: {
            X: { userId: newX.userId, username: newX.username, elo: newX.elo, avatarUrl: newX.avatarUrl || '' },
            O: { userId: newO.userId, username: newO.username, elo: newO.elo, avatarUrl: newO.avatarUrl || '' }
          },
          displayLeft:  { userId: leftUserId,  piece: leftPiece },
          displayRight: { userId: rightUserId, piece: rightPiece },
          currentTurn: 'X', moveCount: 0
        };
        // Lưu vào game để spectator vào sau nhận được
        newGame.displayLeft  = startData.displayLeft;
        newGame.displayRight = startData.displayRight;
        io.to(roomCode).emit('game_start', startData);
        startMoveTimer(roomCode);
        broadcastLiveGames(io);
      }
    } catch(e) { console.error('casual_rematch:', e); }
  });

  // ── Matchmaking ────────────────────────────────────────────────────────────
  socket.on('join_matchmaking', () => {
    // Chặn nếu đang trong trận đang chơi (không chặn spectator)
    if (socket.currentRoom && !socket.isSpectator) {
      const activeGame = getGame(socket.currentRoom);
      if (activeGame && activeGame.status === 'playing') {
        socket.emit('toast', { msg: 'Bạn đang trong trận đấu. Hãy kết thúc trước khi tìm trận mới!', type: 'w' });
        return;
      }
    }
    leaveCurrentRoom(false);
    const u = freshUser();
    const joined = joinQueue({ socketId: socket.id, userId, username, elo: u.elo, avatarUrl: u.avatar_url || '' });
    if (joined) socket.emit('matchmaking_status', { status: 'searching' });
    io.emit('queue_size', { count: getQueueSize() }); // broadcast ngay khi join
  });

  socket.on('cancel_matchmaking', () => {
    leaveQueue(userId);
    socket.emit('matchmaking_status', { status: 'cancelled' });
    io.emit('queue_size', { count: getQueueSize() });
  });

  // ── Make move ──────────────────────────────────────────────────────────────
  socket.on('make_move', ({ roomCode, row, col }) => {
    try {
      const game = getGame(roomCode);
      if (!game || game.status !== 'playing') return;
      if (socket.isSpectator) return;
      const piece = game.players.X.userId === userId ? 'X' :
                    game.players.O.userId === userId ? 'O' : null;
      if (!piece || piece !== game.currentTurn) return;
      if (piece === 'X') game.players.X.socketId = socket.id;
      else game.players.O.socketId = socket.id;
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;
      if (game.board[row][col] !== null) return;
      if (isForbidden(game, row, col)) return;

      game.board[row][col] = piece;
      if (piece === 'X' && game.moveCount === 0) game.xFirst = [row, col];
      game.moveCount++;
      game.currentTurn = piece === 'X' ? 'O' : 'X';

      const winCells = checkWinner(game.board, row, col, piece);
      io.to(roomCode).emit('move_made', {
        roomCode, row, col, piece,
        nextTurn: game.currentTurn,
        moveCount: game.moveCount,
        winCells: winCells || null
      });

      if (winCells) endGame(roomCode, piece, 'win');
      else if (checkDraw(game.board)) endGame(roomCode, null, 'draw');
      else startMoveTimer(roomCode);
    } catch(e) { console.error('make_move:', e); }
  });

  // ── Draw offer ─────────────────────────────────────────────────────────────
  socket.on('offer_draw', ({ roomCode }) => {
    try {
      const game = getGame(roomCode);
      if (!game || game.status !== 'playing' || socket.isSpectator) return;
      const piece = game.players.X.userId === userId ? 'X' : 'O';
      const otherSid = piece === 'X' ? game.players.O.socketId : game.players.X.socketId;
      const other = io.sockets.sockets.get(otherSid);
      if (other) other.emit('draw_offered', { fromUsername: username });
    } catch(e) {}
  });

  socket.on('accept_draw', ({ roomCode }) => {
    try {
      const game = getGame(roomCode);
      if (!game || game.status !== 'playing' || socket.isSpectator) return;
      endGame(roomCode, null, 'draw');
    } catch(e) {}
  });

  socket.on('decline_draw', ({ roomCode }) => {
    try {
      const game = getGame(roomCode);
      if (!game || game.status !== 'playing' || socket.isSpectator) return;
      const piece = game.players.X.userId === userId ? 'X' : 'O';
      const otherSid = piece === 'X' ? game.players.O.socketId : game.players.X.socketId;
      const other = io.sockets.sockets.get(otherSid);
      if (other) other.emit('draw_declined');
    } catch(e) {}
  });

  // ── Resign ─────────────────────────────────────────────────────────────────
  socket.on('resign', ({ roomCode }) => {
    const game = getGame(roomCode);
    if (!game || game.status !== 'playing' || socket.isSpectator) return;
    const piece = game.players.X.userId === userId ? 'X' : 'O';
    endGame(roomCode, piece === 'X' ? 'O' : 'X', 'resign');
  });

  // ── Casual scores sync ──────────────────────────────────────────────────────
  socket.on('update_casual_scores', ({ roomCode, scores }) => {
    try {
      const game = getGame(roomCode);
      if (game && game.gameType === 'casual') {
        game.casualScores = scores || {};
      }
    } catch(e) {}
  });

  // ── Chat message ───────────────────────────────────────────────────────────
  socket.on('chat_msg', ({ roomCode, message }) => {
    try {
      if (!message || !roomCode) return;
      const txt = String(message).trim().slice(0, 100);
      if (!txt) return;
      const u = freshUser();
      io.to(roomCode).emit('chat_msg', {
        roomCode,
        username,
        avatarUrl: u.avatar_url || '',
        message: txt,
        isSpectator: socket.isSpectator
      });
    } catch(e) {}
  });

  // ── Leave / Disconnect ─────────────────────────────────────────────────────
  socket.on('leave_room', () => leaveCurrentRoom(true));

  socket.on('disconnect', () => {
    leaveQueue(userId);
    const room = socket.currentRoom;
    if (!room) return;
    if (socket.isSpectator) {
      socket.leave(room);
      broadcastLiveGames(io);
      return;
    }
    const game = getGame(room);
    if (game && game.status === 'playing') {
      const key = `user_${userId}`;
      const timer = setTimeout(() => {
        disconnectTimers.delete(key);
        const g = getGame(room);
        if (g && g.status === 'playing') {
          const lp = g.players.X.userId === userId ? 'X' : 'O';
          endGame(room, lp === 'X' ? 'O' : 'X', 'disconnect');
        }
      }, DISCONNECT_GRACE);
      disconnectTimers.set(key, timer);
      io.to(room).emit('player_disconnected', { username, gracePeriod: DISCONNECT_GRACE / 1000 });
    } else {
      if (waitingRooms.has(room)) { waitingRooms.delete(room); broadcastRooms(io); }
    }
    socket.currentRoom = null;
  });

  socket.on('get_online_count', () =>
    socket.emit('online_count', { count: io.sockets.sockets.size })
  );
}


// ── Matchmaking ticker ────────────────────────────────────────────────────────
function initMatchmaking(io) {
  startTicker(io, (p1, p2) => {
    const { leaveQueue } = require('./matchmaking');
    leaveQueue(p1.userId); leaveQueue(p2.userId);
    const u1 = findUserById(p1.userId) || {}; const u2 = findUserById(p2.userId) || {};
    p1.elo = u1.elo || p1.elo; p2.elo = u2.elo || p2.elo;
    p1.avatarUrl = u1.avatar_url || ''; p2.avatarUrl = u2.avatar_url || '';
    const code = generateRoomCode();
    const s1 = io.sockets.sockets.get(p1.socketId);
    const s2 = io.sockets.sockets.get(p2.socketId);
    if (!s1 || !s2) return;
    // Fix #1: Leave any previous room (e.g. spectating) before joining the new match
    // room. Without this, the socket remains subscribed to the old room and events
    // (move_made, chat_msg, timer, game_over) from that room bleed into the new match.
    if (s1.currentRoom) s1.leave(s1.currentRoom);
    if (s2.currentRoom) s2.leave(s2.currentRoom);
    s1.join(code); s1.currentRoom = code; s1.isSpectator = false;
    s2.join(code); s2.currentRoom = code; s2.isSpectator = false;
    const coinFlip = Math.random() < 0.5;
    const playerX = coinFlip ? p1 : p2;
    const playerO = coinFlip ? p2 : p1;
    const game = createGame(code, playerX, playerO);
    game.gameType = 'ranked';
    const startData = {
      roomCode: code, gameType: 'ranked',
      board: game.board, forbidden: game.forbidden,
      players: {
        X: { userId: playerX.userId, username: playerX.username, elo: playerX.elo, avatarUrl: playerX.avatarUrl || '' },
        O: { userId: playerO.userId, username: playerO.username, elo: playerO.elo, avatarUrl: playerO.avatarUrl || '' }
      },
      currentTurn: 'X', moveCount: 0
    };
    io.to(code).emit('matched', { roomCode: code });
    io.to(code).emit('game_start', startData);
    broadcastLiveGames(io);
    io.emit('queue_size', { count: getQueueSize() }); // broadcast sau khi match
    game.timeLeft = MOVE_TIME;
    io.to(code).emit('timer', { roomCode: code, timeLeft: MOVE_TIME });
    game.timer = setInterval(() => {
      game.timeLeft--;
      io.to(code).emit('timer', { roomCode: code, timeLeft: game.timeLeft });
      if (game.timeLeft <= 0) {
        clearInterval(game.timer); game.timer = null;
        const g = require('./game').getGame(code);
        if (!g || g.status !== 'playing') return;
        const winner = g.currentTurn === 'X' ? 'O' : 'X';
        // endGame via imported function
        g.status = 'finished';
        const up = g.players;
        const ux = findUserById(up.X.userId) || { elo: up.X.elo, total_ranked_games: 0 };
        const uo = findUserById(up.O.userId) || { elo: up.O.elo, total_ranked_games: 0 };
        const isXWin = winner === 'X';
        const { winnerDelta, loserDelta } = calcELO(
          isXWin ? ux.elo : uo.elo, isXWin ? uo.elo : ux.elo,
          isXWin ? ux.total_ranked_games : uo.total_ranked_games,
          isXWin ? uo.total_ranked_games : ux.total_ranked_games
        );
        const xD = isXWin ? winnerDelta : loserDelta;
        const oD = isXWin ? loserDelta : winnerDelta;
        updateUserStats(up.X.userId, { eloDelta: xD, result: isXWin ? 'win' : 'loss', gameType: 'ranked' });
        updateUserStats(up.O.userId, { eloDelta: oD, result: isXWin ? 'loss' : 'win', gameType: 'ranked' });
        saveGame({
          roomCode: code, gameType: 'ranked',
          player1Id: up.X.userId, player2Id: up.O.userId,
          winnerId: isXWin ? up.X.userId : up.O.userId, draw: false,
          p1EloBefore: ux.elo, p2EloBefore: uo.elo,
          p1EloAfter: ux.elo + xD, p2EloAfter: uo.elo + oD,
          totalMoves: g.moveCount
        });
        io.to(code).emit('game_over', {
          reason: 'timeout', draw: false, gameType: 'ranked',
          winner: { userId: isXWin ? up.X.userId : up.O.userId, username: isXWin ? up.X.username : up.O.username },
          eloChanges: {
            [up.X.userId]: { delta: xD, newElo: ux.elo + xD },
            [up.O.userId]: { delta: oD, newElo: uo.elo + oD }
          }
        });
        require('./game').deleteGame(code);
        broadcastLiveGames(io);
      }
    }, 1000);
  });
}

module.exports = { setupHandlers, initMatchmaking, broadcastLiveGames, broadcastOnlineUsers };
