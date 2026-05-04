'use strict';
const BOARD_SIZE = 19;
const WIN_LENGTH = 5;
const MOVE_TIME  = 60;

const games       = new Map();
const waitingRooms = new Map();

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

// 3 forbidden cells on perimeter of square A (rows5-12, cols5-13), spaced >=7 apart
function genForbidden() {
  const p = [];
  for (let c = 5; c <= 13; c++) p.push([5, c]);
  for (let r = 6; r <= 12; r++) p.push([r, 13]);
  for (let c = 12; c >= 5; c--) p.push([12, c]);
  for (let r = 11; r >= 6; r--) p.push([r, 5]);
  const n = p.length; // 30
  const i1 = Math.floor(Math.random() * n);
  const i2 = (i1 + 10 + Math.floor(Math.random() * 4)) % n;
  const i3 = (i1 + 20 + Math.floor(Math.random() * 4)) % n;
  return [p[i1], p[i2], p[i3]];
}

function createGame(roomCode, playerX, playerO) {
  const state = {
    roomCode, board: createEmptyBoard(), forbidden: genForbidden(),
    players: { X: playerX, O: playerO },
    currentTurn: 'X', status: 'playing',
    moveCount: 0, xFirst: null,
    timer: null, timeLeft: MOVE_TIME,
    // Rich history tracking
    turnStartTime: Date.now(), // reset on each move for think_time_ms
    pendingMoves: [],          // buffered until game ends, then bulk-inserted
  };
  games.set(roomCode, state);
  return state;
}

const getGame    = rc => games.get(rc);
const isForbidden = (game, r, c) => game.forbidden.some(([fr,fc]) => fr===r && fc===c);

function deleteGame(roomCode) {
  const g = games.get(roomCode);
  if (g?.timer) clearInterval(g.timer);
  games.delete(roomCode);
}

function checkWinner(board, row, col, piece) {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const cells = [[row, col]];
    for (const sign of [1, -1]) {
      for (let i = 1; i < WIN_LENGTH; i++) {
        const r = row + dr*i*sign, c = col + dc*i*sign;
        if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE||board[r][c]!==piece) break;
        cells.push([r, c]);
      }
    }
    if (cells.length >= WIN_LENGTH) return cells;
  }
  return null;
}

const checkDraw = board => board.every(row => row.every(c => c !== null));

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:6}, () => chars[Math.random()*chars.length|0]).join(''); }
  while (waitingRooms.has(code) || games.has(code));
  return code;
}

module.exports = {
  games, waitingRooms,
  createGame, getGame, deleteGame,
  isForbidden, checkWinner, checkDraw,
  generateRoomCode, MOVE_TIME, BOARD_SIZE
};
