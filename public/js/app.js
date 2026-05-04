'use strict';
// ─── State ────────────────────────────────────────────────────────────────────
var socket = null, currentUser = null, currentRoom = null, chatOn = true;
var wtTimer = null, wtSec = 0, isSpectator = false;
var BD = [], FORB = [], turn = 'X', mc = 0;
var xF = null, oF = null, sel = null;
var over = false, wc = [], myP = null, gameType = 'ranked';
var leftPieceCur = 'X', rightPieceCur = 'O'; // quân cờ hiển thị ở vị trí trái/phải
var bOp = 0.12, nOp = 0.0; // số ẩn mặc định
var lastMove = null; // [row, col, piece]
// zoom removed
var liveGames = [], waitRooms = {};
var gInitDone = false;
var onlineUserIds = new Set();
var casualScores = {};        // { userId: score } - lưu theo userId
var casualPlayerIds = { X: null, O: null }; // userId của X/O hiện tại
var rematchVoted = false;

// ─── Utils ────────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function set(id, v) { var e = $(id); if (e) e.textContent = v; }
function esc(s) { var d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; }

function toast(msg, type, dur) {
  var w = $('toast-wrap'); if (!w) return;
  var t = document.createElement('div');
  t.className = 'toast t' + (type || 'i');
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, dur || 3500);
}

// ─── Board sizing ─────────────────────────────────────────────────────────────
function calcCellSize() {
  // Chỉ tính theo chiều ngang - board fill full width
  // Chiều dọc scroll được trong bwrap
  var vw = Math.min(window.innerWidth, 620);
  var cs = Math.floor((vw - 16) / 19);
  return Math.max(14, Math.min(cs, 36));
}

function applyBoardSize() {
  var cs = calcCellSize();
  var board = $('board'); if (!board) return;
  // Reset margins trước khi tính lại
  var bi = $('binner'); if (bi) { bi.style.marginRight='0'; bi.style.marginBottom='0'; }
  var col = 'repeat(19,' + cs + 'px)';
  board.style.gridTemplateColumns = col;
  board.style.gridTemplateRows = col;
  document.querySelectorAll('.cell').forEach(function(c) {
    c.style.width = cs + 'px'; c.style.height = cs + 'px';
  });
  var numSz = Math.max(7, Math.floor(cs * 0.30)) + 'px';
  var pieceSz = Math.floor(cs * 0.68) + 'px';
  document.querySelectorAll('.cnum').forEach(function(n) { n.style.fontSize = numSz; });
  document.querySelectorAll('.PX,.PO').forEach(function(p) { p.style.fontSize = pieceSz; });
}
window.addEventListener('resize', applyBoardSize);

// ─── Avatar helper ────────────────────────────────────────────────────────────
function getInitials(name) {
  var words = (name || '').trim().split(/\s+/);
  return words.length >= 2 ? (words[0][0] || '') + (words[1][0] || '') : (name || '??').substring(0, 2).toUpperCase();
}

function avatarHtml(username, avatarUrl, szClass, extraStyle) {
  var init = getInitials(username);
  var style = extraStyle || '';
  if (avatarUrl) {
    var errFn = "this.style.display='none';this.parentNode.textContent=" + JSON.stringify(init);
    return '<div class="av ' + (szClass || 'sz42') + '" style="padding:0;overflow:hidden;' + style + '">' +
      '<img src="' + esc(avatarUrl) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="' + errFn + '">' +
      '</div>';
  }
  return '<div class="av av-g ' + (szClass || 'sz42') + '" style="' + style + '">' + esc(init) + '</div>';
}

// ─── Google Sign-In ───────────────────────────────────────────────────────────
function getClientId() { var el = $('g_id_onload'); return el ? el.getAttribute('data-client_id') || '' : ''; }
function initGoogleSdk() {
  if (!window.google || !window.google.accounts) { setTimeout(initGoogleSdk, 400); return; }
  if (gInitDone) return;
  var cid = getClientId(); if (!cid) return;
  gInitDone = true;
  google.accounts.id.initialize({ client_id: cid, callback: onGoogleCallback, auto_select: false, use_fedcm_for_prompt: false });
  renderGoogleBtn();
}
function renderGoogleBtn() {
  var rt = $('google-render-target');
  if (rt && window.google && window.google.accounts && gInitDone) {
    rt.innerHTML = '';
    google.accounts.id.renderButton(rt, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with_google', locale: 'vi' });
  }
}
async function onGoogleCallback(r) {
  try { var data = await API.loginGoogle(r.credential); afterAuth(data); }
  catch(ex) { toast('Lỗi đăng nhập: ' + ex.message, 'e'); }
}
function onGoogleLogin(r) { onGoogleCallback(r); }
function doGoogleLogin() {
  if (!gInitDone) { toast('Đang tải...', 'i'); setTimeout(function() { initGoogleSdk(); setTimeout(doGoogleLogin, 800); }, 300); return; }
  var cid = getClientId(); if (!cid) { toast('Chưa cấu hình Google Client ID', 'e'); return; }
  google.accounts.id.prompt(function(n) {
    if (n.isNotDisplayed && n.isNotDisplayed()) toast('Dùng nút Google bên dưới', 'i');
  });
}

async function loadConfig() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    if (cfg.devMode) {
      const devBtn = $('dev-login-btn');
      if (devBtn) devBtn.style.display = 'block';
    }
  } catch(e) {}
}

async function doDevLogin() {
  const username = prompt('Enter username for Dev Login:');
  if (!username) return;
  try {
    const data = await API.loginDev(username);
    afterAuth(data);
  } catch(ex) {
    toast('Dev Login error: ' + ex.message, 'e');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initGoogleSdk();
    loadConfig();
  });
} else {
  setTimeout(() => {
    initGoogleSdk();
    loadConfig();
  }, 200);
}

// ─── Overlays ─────────────────────────────────────────────────────────────────
function showOv(id) {
  var e = $(id); if (!e) return;
  e.style.display = 'flex';
  if (id === 'login-ov') setTimeout(renderGoogleBtn, 100);
}
function closeById(id) { var e = $(id); if (e) e.style.display = 'none'; }
function closeOv(e, id) { if (e.target === e.currentTarget) closeById(id); }
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') ['login-ov', 'create-ov', 'join-ov', 'draw-modal', 'pw-modal'].forEach(closeById);
});
document.addEventListener('click', function(e) {
  var pp = $('pp'), aa = $('auth-area');
  if (pp && pp.style.display !== 'none' && !pp.contains(e.target) && (!aa || !aa.contains(e.target)))
    pp.style.display = 'none';
}, true);



// ─── Announcement ─────────────────────────────────────────────────────────────
var ADMIN_EMAIL = 'thayquyencaro@gmail.com';

function renderAnnouncement(content) {
  var wrap = $('announcement-wrap');
  var text = $('ann-text');
  var editBtn = $('ann-edit-btn');
  if (!wrap) return;
  if (!content || !content.trim()) {
    // Admin vẫn thấy box rỗng để edit
    if (currentUser && currentUser.email === ADMIN_EMAIL) {
      wrap.style.display = 'block';
      if (text) text.textContent = '(Chưa có thông báo)';
      if (editBtn) editBtn.style.display = 'inline';
    } else {
      wrap.style.display = 'none';
    }
    return;
  }
  wrap.style.display = 'block';
  if (text) text.textContent = content;
  if (editBtn) editBtn.style.display = (currentUser && currentUser.email === ADMIN_EMAIL) ? 'inline' : 'none';
}

async function loadAnnouncement() {
  try {
    var res = await fetch('/api/announcement');
    var data = await res.json();
    renderAnnouncement(data.content || '');
  } catch(e) {}
}

function editAnnouncement() {
  var inp = $('ann-input');
  var text = $('ann-text');
  if (inp && text) inp.value = text.textContent === '(Chưa có thông báo)' ? '' : (text.textContent || '');
  showOv('ann-modal');
}

async function saveAnnouncement() {
  var content = ($('ann-input') || {value:''}).value.trim();
  try {
    var res = await fetch('/api/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (API.token || '') },
      body: JSON.stringify({ content })
    });
    var data = await res.json();
    if (data.ok) { closeById('ann-modal'); toast('Đã cập nhật thông báo', 's'); }
    else toast(data.error || 'Lỗi', 'e');
  } catch(e) { toast('Lỗi kết nối', 'e'); }
}

// ─── Global Chat icon
function gcOpen() { toast('Chat chung - sắp ra mắt!', 'i'); }
// ─── Donate ───────────────────────────────────────────────────────────────────
function showDonate() { showOv('donate-modal'); }

function copySTK() {
  var stk = '0933905525';
  navigator.clipboard.writeText(stk).then(function() {
    var btn = $('copy-stk-btn');
    if (btn) { btn.textContent = '✅ Đã copy!'; setTimeout(function(){ btn.textContent = '📋 Copy'; }, 2000); }
    toast('Đã sao chép số tài khoản!', 's');
  }).catch(function() {
    // Fallback nếu clipboard không hoạt động
    var el = document.createElement('textarea');
    el.value = stk; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    toast('Đã sao chép số tài khoản!', 's');
  });
}

function showLoginPopup() { showOv('login-ov'); }
function showCreatePopup() {
  if (!socket) { showOv('login-ov'); return; }
  var wb = $('wait-box'); if (wb) wb.style.display = 'none';
  showOv('create-ov');
}
function showJoinPopup() {
  if (!socket) { showOv('login-ov'); return; }
  set('join-err', ''); showOv('join-ov');
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function afterAuth(data) {
  API.setToken(data.token);
  currentUser = data.user;
  closeById('login-ov');
  connectSocket(data.token);
  toast('Xin chào, ' + data.user.username, 's');
}

function doLogout() {
  if (socket) { socket.disconnect(); socket = null; }
  API.setToken(null); currentUser = null; currentRoom = null;
  closeById('pp');
  $('auth-area').innerHTML = '<button class="btn-login" onclick="showLoginPopup()">Đăng nhập</button>';
  toast('Đã đăng xuất', 'i');
}

function togglePP() {
  var p = $('pp'); if (!p) return;
  p.style.display = p.style.display !== 'none' ? 'none' : 'block';
  if (p.style.display === 'block') updateHdr();
}

function updateHdr() {
  if (!currentUser) return;
  var n = currentUser.username || '?';
  var av = currentUser.avatarUrl || '';
  var init = getInitials(n);
  $('auth-area').innerHTML = av
    ? '<div onclick="togglePP()" style="cursor:pointer;width:42px;height:42px;border-radius:50%;overflow:hidden;border:2.5px solid #22c55e;">' +
      '<img src="' + esc(av) + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.innerHTML=\'' + esc(init) + '\'">' +
      '</div>'
    : '<div class="av-btn-hdr" onclick="togglePP()" title="' + esc(n) + '">' + esc(init) + '</div>';

  var ppAv = $('pp-av');
  if (ppAv) {
    ppAv.innerHTML = av
      ? '<img src="' + esc(av) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.outerHTML=\'' + esc(init) + '\'">'
      : init;
  }
  set('pp-name', n);
  set('pp-elo', 'ELO ' + (currentUser.elo || 1200));
  set('pp-stat', (currentUser.wins || 0) + ' thắng · ' + (currentUser.losses || 0) + ' thua · ' + (currentUser.draws || 0) + ' hòa');
  // Avatar tab Thi đấu: hiển thị ảnh Google nếu có
  // my-av-td removed (thidau tab no longer shows avatar)
  // set('my-elo-td', currentUser.elo || 1200);
  loadAnnouncement();
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function nav(tab) {
  if (tab === 'home') loadAnnouncement();
  document.querySelectorAll('.nt').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tp').forEach(function(p) { p.classList.remove('active'); });
  var nt = $('nt-' + tab); if (nt) nt.classList.add('active');
  var tp = $('tp-' + tab); if (tp) tp.classList.add('active');
  var cnt = $('cnt'); if (cnt) cnt.scrollTop = 0;
  if (tab === 'xephang') loadLB();
  if (tab === 'giaoluu') { renderRooms(); renderCasualLive(); }
  if (tab === 'thidau') renderRankedLive();
}

// ─── Socket ───────────────────────────────────────────────────────────────────
function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });

  socket.on('connect', function() {
    updateHdr();
    socket.emit('get_online_count');
  });
  socket.on('connect_error', function(err) { toast('Lỗi kết nối: ' + err.message, 'e'); });
  socket.on('toast', function(d) { toast(d.msg, d.type || 'i'); });
  socket.on('online_count', function(d) { /* ocnt moved to online-count-lbl */ });
  socket.on('disconnect', function() { toast('Mất kết nối. Đang kết nối lại...', 'e'); });

  socket.on('announcement', function(d) {
    renderAnnouncement(d.content || '');
  });

  socket.on('rooms_update', function(rooms) { waitRooms = rooms || {}; renderRooms(); });
  socket.on('online_users', function(users) {
    onlineUserIds = new Set((users || []).map(function(u) { return u.userId; }));
    renderOnlineUsers(users);
  });
  socket.on('live_games', function(games) { liveGames = games || []; renderLiveGames(); });

  socket.on('queue_size', function(d) {
    var qi = $('queue-info'), qc = $('queue-count');
    if (!qi || !qc) return;
    qc.textContent = d.count || 0;
    qi.style.display = (d.count > 0) ? 'block' : 'none';
  });

  socket.on('room_created', function(d) {
    currentRoom = d.roomCode;
    set('rcode', d.roomCode);
    var wb = $('wait-box'); if (wb) wb.style.display = 'block';
    toast('Đã tạo phòng ' + d.roomCode, 's');
  });

  socket.on('room_error', function(d) {
    if (d.message) toast(d.message, 'e');
    set('join-err', d.message || '');
    set('pw-err', d.message || '');
  });

  socket.on('matched', function(d) {
    currentRoom = d.roomCode;
    toast('Tìm thấy đối thủ! Bắt đầu...', 's');
    resetMatchUI();
  });

  socket.on('matchmaking_status', function(d) {
    if (d.status === 'searching') {
      var fb = $('find-btn'), sr = $('searching');
      if (fb) fb.style.display = 'none';
      if (sr) sr.style.display = 'block';
      if (!wtTimer) { wtSec = 0; wtTimer = setInterval(function() { wtSec++; set('wt', wtSec); }, 1000); }
    } else resetMatchUI();
  });

  socket.on('game_start', function(data) {
    currentRoom = data.roomCode;
    gameType = data.gameType || 'ranked';
    isSpectator = data.isSpectator || false;
    closeById('create-ov'); closeById('join-ov'); closeById('login-ov'); closeById('pw-modal');
    closeById('result-modal'); // Đóng kết quả cũ khi có ván mới
    var _rab = $('result-action-btn'); if (_rab) { _rab.style.display = 'none'; _rab._action = null; }
    startGame(data);
    resetMatchUI(); cancelRoomUI();
  });

  socket.on('move_made', function(d) {
    // Fix #4: Ignore events not belonging to our current room (defense-in-depth).
    if (d.roomCode && d.roomCode !== currentRoom) return;
    playMove(d.piece); // âm thanh nước đi
    if (d.piece === 'X' && mc === 0) xF = [d.row, d.col];
    if (d.piece === 'O' && mc === 1) oF = [d.row, d.col];
    if (BD[d.row]) BD[d.row][d.col] = d.piece;
    mc = d.moveCount; turn = d.nextTurn; sel = null;
    if (d.winCells) wc = d.winCells;
    lastMove = [d.row, d.col, d.piece];
    renderBoard(); updatePUI(); saveState();
  });

  socket.on('timer', function(d) {
    // Fix #4: Ignore timer ticks from a room we are no longer in.
    if (d.roomCode && d.roomCode !== currentRoom) return;
    var elId = turn === 'X' ? 'tx' : 'to';
    set(elId, d.timeLeft);
    if (d.timeLeft <= 10 && d.timeLeft > 0) beep();
  });

  socket.on('game_over', function(result) {
    over = true;
    sessionStorage.removeItem('vncaro_game');
    // Nếu server gửi casualScores mới nhất -> dùng ngay (cho cả spectator)
    if (result.casualScores && result.gameType === 'casual') {
      casualScores = result.casualScores;
      updateCasualScore();
    }
    // scores từ server đã đúng, không tự cộng thêm ở client
    if (currentUser && result.eloChanges && result.eloChanges[currentUser.id]) {
      currentUser.elo = result.eloChanges[currentUser.id].newElo;
      updateHdr();
    }
    showResult(result);
  });

  socket.on('player_disconnected', function(d) {
    toast(d.username + ' mất kết nối. Chờ ' + d.gracePeriod + 's...', 'i');
  });

  socket.on('draw_offered', function(d) {
    showDrawModal(d.fromUsername);
  });

  socket.on('draw_declined', function() {
    toast('Đối thủ từ chối hòa ❌', 'e');
  });

  socket.on('viewers_update', function(d) {
    // d = { players: {X,O}, spectators: [{username, avatarUrl}] }
    updateViewersBar(d.players, d.spectators);
  });

  socket.on('rematch_vote', function(d) {
    if (d.count < 2) {
      toast(d.username + ' muốn chơi lại... 🔄', 'i');
    }
    // Khi đủ 2 vote, server sẽ emit game_start
  });

  socket.on('chat_msg', function(d) {
    // Fix #4: Only show chat from the room we are currently in.
    if (d.roomCode && d.roomCode !== currentRoom) return;
    showFloatMsg(d.username, d.message, d.isSpectator);
  });
}


// ─── Online users list ────────────────────────────────────────────────────────
function renderOnlineUsers(users) {
  var avEl  = $('online-avatars');
  var cntEl = $('online-count-lbl');
  if (!avEl) return;

  var count = users ? users.length : 0;
  if (cntEl) cntEl.textContent = count + ' online';

  if (!count) { avEl.innerHTML = ''; return; }

  // Hiển thị tối đa 10 avatar, 1 hàng không xuống dòng
  avEl.innerHTML = users.slice(0, 10).map(function(u) {
    var init = getInitials(u.username);
    var inner = u.avatarUrl
      ? '<img src="' + esc(u.avatarUrl) + '" alt="' + esc(init) + '">'
      : esc(init);
    return '<div class="onl-av" title="' + esc(u.username) + '">' + inner + '</div>';
  }).join('');
}

// ─── Live games (Home tab) ────────────────────────────────────────────────────
function renderLiveGames() {
  renderCasualLive();
  renderRankedLive();
}

function renderCasualLive() {
  var el = $('room-playing-list'); if (!el) return;
  var casual = liveGames.filter(function(g) { return g.gameType !== 'ranked'; });
  el.innerHTML = casual.length
    ? casual.map(liveCard).join('')
    : '<p class="empty">Chưa có trận giao lưu nào</p>';
}

function renderRankedLive() {
  var el = $('ranked-live-list'); if (!el) return;
  var ranked = liveGames.filter(function(g) { return g.gameType === 'ranked'; });
  el.innerHTML = ranked.length
    ? ranked.map(liveCard).join('')
    : '<p class="empty">Chưa có trận thi đấu nào</p>';
}

function liveCard(g) {
  var canRejoin = currentUser && (g.playerX.userId === currentUser.id || g.playerO.userId === currentUser.id);
  var onclick = canRejoin ? 'rejoinGame(\'' + g.roomCode + '\')' : 'watchGame(\'' + g.roomCode + '\')';
  var typeIcon = g.gameType === 'ranked' ? '🥊' : '🤝';
  var hint = canRejoin ? '↩' : '👁';
  var avX = avatarHtml(g.playerX.username, g.playerX.avatarUrl, 'sz36', '');
  var avO = avatarHtml(g.playerO.username, g.playerO.avatarUrl, 'sz36', '');
  var statX = (g.playerX.rank ? '#'+g.playerX.rank+' · ' : '') + (g.playerX.wins||0)+'W/'+(g.playerX.losses||0)+'L/'+(g.playerX.draws||0)+'D';
  var statO = (g.playerO.rank ? '#'+g.playerO.rank+' · ' : '') + (g.playerO.wins||0)+'W/'+(g.playerO.losses||0)+'L/'+(g.playerO.draws||0)+'D';
  var pX =
    '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:0;">' +
      avX +
      '<div style="font-size:11px;font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:#1a5c38;">' + esc(g.playerX.username) + '</div>' +
      '<div style="font-size:9px;color:#888;text-align:center;white-space:nowrap;">' + statX + '</div>' +
    '</div>';
  var mid =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex-shrink:0;padding:0 6px;">' +
      '<span style="font-size:18px;">' + typeIcon + '</span>' +
      '<span style="font-size:9px;color:#aaa;">' + hint + (g.spectatorCount ? ' '+g.spectatorCount : '') + '</span>' +
    '</div>';
  var pO =
    '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:0;">' +
      avO +
      '<div style="font-size:11px;font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:#1a5c38;">' + esc(g.playerO.username) + '</div>' +
      '<div style="font-size:9px;color:#888;text-align:center;white-space:nowrap;">' + statO + '</div>' +
    '</div>';
  return '<div class="cd mcard" onclick="' + onclick + '">' +
    '<div style="display:flex;align-items:center;">' + pX + mid + pO + '</div>' +
  '</div>';
}

function watchGame(roomCode) {
  if (!socket) { showOv('login-ov'); return; }
  socket.emit('watch_game', { roomCode });
  toast('Đang vào xem...', 'i');
}

function rejoinGame(roomCode) {
  if (!socket) { showOv('login-ov'); return; }
  socket.emit('rejoin_game', { roomCode });
  toast('Đang quay lại...', 'i');
}

// ─── Rooms (Giao lưu tab) ─────────────────────────────────────────────────────
function renderRooms() {
  var wEl = $('room-waiting-list'); if (!wEl) return;
  var codes = Object.keys(waitRooms);
  if (!codes.length) {
    wEl.innerHTML = '<p class="empty">Chưa có phòng nào đang chờ</p>';
  } else {
    wEl.innerHTML = codes.map(function(code) {
      var r = waitRooms[code];
      var av = avatarHtml(r.username, r.avatarUrl, 'sz36', '');
      return '<div class="rcard" onclick="clickRoom(\'' + code + '\',' + (r.locked ? 'true' : 'false') + ')">' +
        av +
        '<div class="rinfo"><div class="rname">' + esc(r.username) + '</div>' +
        '<div class="rsub">' + (r.locked ? '🔒 Có mật khẩu' : '🔓 Phòng mở') + '</div></div>' +
        '<button class="btn-sm">Vào</button></div>';
    }).join('');
  }
  renderCasualLive();
}

function clickRoom(code, locked) {
  if (!socket) { showOv('login-ov'); return; }
  if (locked) {
    // Show password modal
    $('pw-room-code').value = code;
    set('pw-err', '');
    $('pw-input').value = '';
    showOv('pw-modal');
  } else {
    joinByCode(code, '');
  }
}

function submitPwModal() {
  var code = $('pw-room-code')?.value || '';
  var pw = $('pw-input')?.value || '';
  joinByCode(code, pw);
}

function createRoom() {
  if (!socket) { showOv('login-ov'); return; }
  casualScores = {}; casualPlayerIds = { X: null, O: null, _left: null, _right: null };
  leftPieceCur = 'X'; rightPieceCur = 'O';
  socket.emit('create_room', { password: ($('rpw') || { value: '' }).value.trim() });
}

function cancelRoom() {
  if (socket && currentRoom) { socket.emit('leave_room'); currentRoom = null; }
  cancelRoomUI(); closeById('create-ov');
  casualScores = {}; casualPlayerIds = { X: null, O: null, _left: null, _right: null };
  leftPieceCur = 'X'; rightPieceCur = 'O';
}

function cancelRoomUI() { var wb = $('wait-box'); if (wb) wb.style.display = 'none'; }

function joinManual() {
  if (!socket) { showOv('login-ov'); return; }
  var code = ($('join-code') || { value: '' }).value.trim().toUpperCase();
  var pw = ($('join-pw') || { value: '' }).value.trim();
  set('join-err', '');
  if (code.length !== 6) { set('join-err', 'Mã phòng gồm 6 ký tự'); return; }
  joinByCode(code, pw);
}

function joinByCode(code, password) {
  if (!socket) { showOv('login-ov'); return; }
  // Reset casual state trước khi vào phòng mới
  casualScores = {}; casualPlayerIds = { X: null, O: null, _left: null, _right: null };
  leftPieceCur = 'X'; rightPieceCur = 'O';
  socket.emit('join_room', { roomCode: code, password: password || '' });
  closeById('join-ov'); closeById('pw-modal');
}

// ─── Matchmaking ──────────────────────────────────────────────────────────────
function findMatch() {
  if (!socket) { showOv('login-ov'); return; }
  socket.emit('join_matchmaking');
}

function cancelMatch() {
  if (socket) socket.emit('cancel_matchmaking');
  resetMatchUI();
}

function resetMatchUI() {
  if (wtTimer) { clearInterval(wtTimer); wtTimer = null; } wtSec = 0;
  var fb = $('find-btn'), sr = $('searching');
  if (fb) fb.style.display = 'block';
  if (sr) sr.style.display = 'none';
  set('wt', '0');
}

// ─── Game ─────────────────────────────────────────────────────────────────────
function startGame(data) {
  BD = data.board; FORB = data.forbidden || [];
  turn = data.currentTurn; gameType = data.gameType || 'ranked';
  isSpectator = data.isSpectator || false;
  mc = data.moveCount || 0;
  sel = null; over = false; wc = []; lastMove = null;
  rematchVoted = false;

  // Reconstruct xFirst/oFirst from board state (for rejoin)
  xF = null; oF = null;
  if (mc > 0) {
    for (var r = 0; r < 19; r++) for (var c = 0; c < 19; c++) {
      if (BD[r] && BD[r][c] === 'X' && !xF) { xF = [r, c]; }
      if (BD[r] && BD[r][c] === 'O' && !oF) { oF = [r, c]; }
    }
  }

  myP = (!isSpectator && currentUser) ? (data.players.X.userId === currentUser.id ? 'X' : 'O') : null;
  casualPlayerIds.X = data.players.X.userId;
  casualPlayerIds.O = data.players.O.userId;
  // ── Vị trí hiển thị player bar ─────────────────────────────────────────────
  // Ván đầu:   trái=X, phải=O (bình thường)
  // Rematch:   trái/phải KHÔNG ĐỔI, chỉ đổi badge X/O
  //            displayLeft/displayRight chứa {userId, piece} cho từng vị trí
  var isRematch = data.isRematch && data.displayLeft && data.displayRight;

  if (isRematch) {
    var leftPiece  = data.displayLeft.piece;
    var rightPiece = data.displayRight.piece;
    leftPieceCur = leftPiece; rightPieceCur = rightPiece;
    casualPlayerIds._left  = data.displayLeft.userId;
    casualPlayerIds._right = data.displayRight.userId;
    var leftElo  = data.displayLeft.userId  === data.players.X.userId ? data.players.X.elo : data.players.O.elo;
    var rightElo = data.displayRight.userId === data.players.X.userId ? data.players.X.elo : data.players.O.elo;
    set('px-elo', 'ELO ' + leftElo);
    set('po-elo', 'ELO ' + rightElo);
    // Spectator join rematch: cần render tên/avatar vì chưa có sẵn
    if (isSpectator) {
      var leftP2  = data.displayLeft.userId  === data.players.X.userId ? data.players.X : data.players.O;
      var rightP2 = data.displayRight.userId === data.players.X.userId ? data.players.X : data.players.O;
      set('px-name', leftP2.username);
      set('po-name', rightP2.username);
      var pxAv2 = $('px-av'), poAv2 = $('po-av');
      if (pxAv2) pxAv2.innerHTML = leftP2.avatarUrl
        ? '<img src="' + esc(leftP2.avatarUrl) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="' + esc(getInitials(leftP2.username)) + '">'
        : getInitials(leftP2.username);
      if (poAv2) poAv2.innerHTML = rightP2.avatarUrl
        ? '<img src="' + esc(rightP2.avatarUrl) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="' + esc(getInitials(rightP2.username)) + '">'
        : getInitials(rightP2.username);
    }
  } else {
    // Ván đầu: X trái, O phải
    leftPieceCur = 'X'; rightPieceCur = 'O';
    casualPlayerIds._left  = data.players.X.userId;
    casualPlayerIds._right = data.players.O.userId;
    var leftP  = data.players.X;
    var rightP = data.players.O;
    set('px-name', leftP.username);
    set('px-elo', 'ELO ' + leftP.elo);
    set('po-name', rightP.username);
    set('po-elo', 'ELO ' + rightP.elo);
    var pxAv = $('px-av'), poAv = $('po-av');
    if (pxAv) pxAv.innerHTML = leftP.avatarUrl
      ? '<img src="' + esc(leftP.avatarUrl) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="' + esc(getInitials(leftP.username)) + '">'
      : getInitials(leftP.username);
    if (poAv) poAv.innerHTML = rightP.avatarUrl
      ? '<img src="' + esc(rightP.avatarUrl) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="' + esc(getInitials(rightP.username)) + '">'
      : getInitials(rightP.username);
  }

  // Badge quân cờ (luôn cập nhật)
  var pxIco = $('px-ico'), poIco = $('po-ico');
  if (pxIco) { pxIco.textContent = leftPieceCur;  pxIco.className = leftPieceCur  === 'X' ? 'PX' : 'PO'; }
  if (poIco) { poIco.textContent = rightPieceCur; poIco.className = rightPieceCur === 'X' ? 'PX' : 'PO'; }

  // Nhận tỉ số từ server SAU KHI _left/_right đã được set đúng
  if (data.casualScores && Object.keys(data.casualScores).length) {
    casualScores = data.casualScores;
  }

  // Casual score
  var csEl = $('casual-score');
  if (csEl) csEl.style.display = gameType === 'casual' ? 'inline' : 'none';
  updateCasualScore();

  var typeLabel = gameType === 'ranked' ? '🏆' : '🤝';
  set('game-room-lbl', typeLabel + ' ' + data.roomCode);

  // Spectator bar
  var specBar = $('spec-bar-txt');
  if (specBar) specBar.textContent = isSpectator ? '👁 Bạn đang xem' : '';

  buildBoard(); renderBoard(); updatePUI();
  // zoom removed
  // Initialize viewers bar with players
  updateViewersBar(data.players, []);
  nav('game'); saveState();
}

function updateCasualScore() {
  var cs = $('casual-score');
  if (!cs) return;
  var leftId  = casualPlayerIds._left  || casualPlayerIds.X;
  var rightId = casualPlayerIds._right || casualPlayerIds.O;
  cs.textContent = (casualScores[leftId] || 0) + ' – ' + (casualScores[rightId] || 0);
}

function buildBoard() {
  var el = $('board'); if (!el) return;
  el.innerHTML = '';
  for (var r = 0; r < 19; r++) {
    for (var c = 0; c < 19; c++) {
      var d = document.createElement('div');
      d.className = 'cell'; d.id = 'c' + r + '_' + c;
      el.appendChild(d);
      (function(row, col) { d.addEventListener('click', function() { clickCell(row, col); }); })(r, c);
    }
  }
  // zoom removed
  applyBoardSize();
}

function isForb(r, c) { return FORB.some(function(f) { return f[0] === r && f[1] === c; }); }
function adjForb(r, c) { return FORB.some(function(f) { return Math.abs(f[0] - r) <= 1 && Math.abs(f[1] - c) <= 1 && !(f[0] === r && f[1] === c); }); }
function inR3(r, c) { if (!xF) return false; return Math.max(Math.abs(r - xF[0]), Math.abs(c - xF[1])) <= 3; }
function phase() { if (mc === 0) return 0; if (mc === 2) return 2; return 1; }
function vis(r, c) {
  if (isForb(r, c)) return 'forb';
  if (BD[r] && BD[r][c]) return 'piece';
  var ph = phase();
  if (ph === 0 && !adjForb(r, c)) return 'hidden';
  if (ph === 2 && inR3(r, c)) {
    if (oF && oF[0] === r && oF[1] === c) return 'piece';
    return 'hidden';
  }
  return 'normal';
}

function renderBoard() {
  for (var r = 0; r < 19; r++) {
    for (var c = 0; c < 19; c++) {
      var d = $('c' + r + '_' + c); if (!d) continue;
      d.className = 'cell'; d.innerHTML = ''; d.style.borderColor = '';
      var v = vis(r, c);
      if (v === 'forb') { d.classList.add('forb'); }
      else if (v === 'hidden') { d.classList.add('hidden'); }
      else if (v === 'piece') {
        d.classList.add('placed');
        var isW = wc.some(function(w) { return w[0] === r && w[1] === c; });
        if (isW) d.classList.add('win-hl');
        // Highlight nước đi cuối
        if (lastMove && lastMove[0]===r && lastMove[1]===c && !isW) {
          d.classList.add(lastMove[2]==='X' ? 'last-x' : 'last-o');
        }
        var sp = document.createElement('span');
        sp.className = BD[r][c] === 'X' ? 'PX' : 'PO';
        sp.textContent = BD[r][c];
        if (isW) sp.style.animation = 'bounce .5s ease-in-out infinite';
        d.appendChild(sp);
      } else {
        d.style.borderColor = 'rgba(0,0,0,' + bOp + ')';
        if (sel && sel[0] === r && sel[1] === c) d.classList.add('sel');
        var num = document.createElement('span');
        num.className = 'cnum';
        num.style.color = 'rgba(0,0,0,' + nOp + ')';
        num.textContent = r * 20 + c + 1;
        d.appendChild(num);
      }
    }
  }
  applyBoardSize();
}

function clickCell(r, c) {
  if (over || !socket || isSpectator) return;
  if (myP !== turn) { toast('Không phải lượt của bạn', 'i'); return; }
  var v = vis(r, c); if (v !== 'normal') return;
  if (phase() === 2 && turn === 'X' && inR3(r, c)) return;
  if (sel && sel[0] === r && sel[1] === c) {
    sel = null;
    socket.emit('make_move', { roomCode: currentRoom, row: r, col: c });
  } else { sel = [r, c]; renderBoard(); }
}

function updatePUI() {
  var isX = turn === 'X';
  // leftPieceCur/rightPieceCur: quân cờ thực tế ở vị trí trái/phải
  // Vị trí trái active khi: quân của họ đang đến lượt
  var leftActive  = (leftPieceCur  === turn);
  var rightActive = (rightPieceCur === turn);
  var txb = $('txb'), tob = $('tob');
  if (txb) txb.className = 'tpill tpx' + (leftActive  && !isSpectator ? ' active-t' : '');
  if (tob) tob.className = 'tpill tpo' + (rightActive && !isSpectator ? ' active-t' : '');
  var pxi = $('px-ico'), poi = $('po-ico');
  if (pxi) pxi.style.animation = leftActive  ? 'bounce .6s ease-in-out infinite' : 'none';
  if (poi) poi.style.animation = rightActive ? 'bounce .6s ease-in-out infinite' : 'none';
  if (!over) {
    var ph = phase();
    if (isSpectator) { set('gstat', 'Đang xem — Lượt ' + turn); return; }
    var myT = myP === turn;
    if (ph === 0) set('gstat', myT ? '⬤ Lượt bạn (X): chọn ô cạnh ô cấm → bấm lần 2 để đặt' : '⏳ Đang chờ đối thủ...');
    else if (ph === 2) set('gstat', myT ? '⬤ Open 4: đặt ô ngoài vùng mờ (bán kính >3)' : '⏳ Đối thủ Open 4...');
    else set('gstat', myT ? '⬤ Lượt của bạn — bấm 2 lần để đặt' : '⏳ Đang chờ đối thủ...');
  }
}

// ─── Draw offer ───────────────────────────────────────────────────────────────
function closeResult(e) {
  // Bấm X hoặc bấm vào nền mờ (không phải vào result-box)
  if (e && e.target !== e.currentTarget) return;
  var rm = $('result-modal'); if (rm) rm.style.display = 'none';
  // Nút action giữ nguyên - không ẩn khi đóng popup
}

function onResultAction() {
  var rab = $('result-action-btn');
  if (!rab) return;
  if (rab._action) rab._action();
}

function offerDraw() {
  if (!socket || !currentRoom || over || isSpectator) return;
  socket.emit('offer_draw', { roomCode: currentRoom });
  toast('Đã gửi đề nghị hòa ✉️', 'i');
}

function showDrawModal(fromUsername) {
  var m = $('draw-modal'); if (!m) return;
  set('draw-from', fromUsername ? fromUsername + ' đề nghị hòa cờ!' : 'Đối thủ đề nghị hòa!');
  m.style.display = 'flex';
}

function acceptDrawOffer() {
  closeById('draw-modal');
  if (socket && currentRoom) socket.emit('accept_draw', { roomCode: currentRoom });
}

function declineDrawOffer() {
  closeById('draw-modal');
  if (socket && currentRoom) {
    socket.emit('decline_draw', { roomCode: currentRoom });
    toast('Đã từ chối hòa', 'i');
  }
}

// ─── Resign ───────────────────────────────────────────────────────────────────
function doResign() {
  if (!socket || !currentRoom || over || isSpectator) return;
  if (!confirm('Bạn có chắc muốn đầu hàng không?')) return;
  socket.emit('resign', { roomCode: currentRoom });
}

// ─── Sliders ──────────────────────────────────────────────────────────────────
function updB(v) {
  bOp = v / 500;
  document.querySelectorAll('.cell:not(.forb):not(.hidden):not(.placed)').forEach(function(c) {
    c.style.borderColor = 'rgba(0,0,0,' + bOp + ')';
  });
}
function updN(v) {
  nOp = v / 100;
  document.querySelectorAll('.cnum').forEach(function(n) { n.style.color = 'rgba(0,0,0,' + nOp + ')'; });
}

// zoom removed

// ─── Chat ─────────────────────────────────────────────────────────────────────
function toggleChat() {
  chatOn = !chatOn;
  var btn = $('chat-toggle-btn');
  if (btn) btn.classList.toggle('muted', !chatOn);
  var ca = $('chat-area'); if (ca) ca.style.display = chatOn ? 'block' : 'none';
  var fz = $('fzone'); if (fz) fz.style.display = chatOn ? '' : 'none';
}

function toggleSl(id) {
  var el = $(id); if (!el) return;
  var isOpen = el.style.display !== 'none';
  // Đóng tất cả slider khác trước
  ['slb-wrap','sln-wrap'].forEach(function(sid) {
    var s = $(sid); if (s) s.style.display = 'none';
  });
  if (!isOpen) el.style.display = 'flex';
}
// Đóng slider khi bấm ra ngoài ctrl
document.addEventListener('click', function(e) {
  if (!e.target.closest('#ctrl')) {
    ['slb-wrap','sln-wrap'].forEach(function(id) {
      var s = $(id); if (s) s.style.display = 'none';
    });
  }
});

function updChatCount() {
  var inp = $('ci'), cnt = $('chat-count');
  if (!inp || !cnt) return;
  var remain = 100 - inp.value.length;
  cnt.textContent = remain;
  cnt.style.color = remain <= 20 ? '#f87171' : remain <= 50 ? '#fbbf24' : '#ccc';
}

function sendMsg() {
  var inp = $('ci'); if (!inp || !inp.value.trim()) return;
  var txt = inp.value.trim().substring(0, 100); inp.value = '';
  if (socket && currentRoom) {
    socket.emit('chat_msg', { roomCode: currentRoom, message: txt });
  } else {
    showFloatMsg(currentUser ? currentUser.username : 'Bạn', txt, false);
  }
}

// Queue tin nhắn: đảm bảo không chồng lấn, ai gửi trước bay trước
// Chat float: realtime, collision-aware, no queue delay
var FLOAT_SPEED = 38;   // px/s
var FLOAT_LIFE  = 14000; // ms
var GAP = 6;            // khoảng cách an toàn giữa 2 tin

function showFloatMsg(username, txt, isSpec) {
  if (!chatOn) return;
  var fz = $('fzone'); if (!fz) return;

  var m = document.createElement('div');
  m.className = 'chat-msg';
  if (isSpec) m.style.opacity = '0.75';
  m.textContent = (username ? username + ': ' : '') + txt;
  m.style.bottom = '4px';
  fz.appendChild(m);

  var startTime = Date.now();
  var curBottom = 4;
  var paused = false;      // đang chờ vì bị block
  var pausedSince = 0;

  function step() {
    if (!m.parentNode) return;
    var now = Date.now();
    var elapsed = now - startTime;
    if (elapsed >= FLOAT_LIFE) { m.parentNode.removeChild(m); return; }

    var mH = m.offsetHeight || 28;

    // Tìm tin NGAY TRÊN (bottom > curBottom, gần nhất)
    var ceiling = Infinity;
    fz.querySelectorAll('.chat-msg').forEach(function(other) {
      if (other === m) return;
      var ob = parseFloat(other.style.bottom) || 0;
      var oh = other.offsetHeight || 28;
      // Đỉnh của other = ob + oh (tính từ dưới lên)
      // Đáy của m = curBottom, đỉnh của m = curBottom + mH
      // other ở trên m khi đáy other (ob) >= đỉnh m (curBottom+mH) - GAP*2
      if (ob + oh > curBottom + mH - GAP && ob > curBottom) {
        ceiling = Math.min(ceiling, ob - mH - GAP);
      }
    });

    var maxMove = ceiling === Infinity ? Infinity : ceiling;

    if (curBottom >= maxMove) {
      // Bị chặn - dừng lại
      if (!paused) { paused = true; pausedSince = now; }
      // Chờ ít nhất 600ms rồi kiểm tra lại
      if (now - pausedSince < 600) {
        requestAnimationFrame(step);
        return;
      }
      // Sau 600ms kiểm tra lại có còn bị block không
      if (curBottom >= maxMove) {
        requestAnimationFrame(step);
        return;
      }
    }
    paused = false;

    // Di chuyển lên
    var newBottom = curBottom + FLOAT_SPEED * (16 / 1000); // ~60fps
    curBottom = Math.min(newBottom, maxMove);
    m.style.bottom = curBottom + 'px';

    // Fade out 2s cuối
    var opacity = elapsed > FLOAT_LIFE - 2000
      ? 1 - (elapsed - (FLOAT_LIFE - 2000)) / 2000 : 1;
    if (!isSpec) m.style.opacity = opacity;

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── Result ───────────────────────────────────────────────────────────────────
function showResult(result) {
  var myId = currentUser ? currentUser.id : -1;
  var icon, title, sub = '';
  if (isSpectator) {
    // Nội dung dành riêng cho người xem
    if (result.draw) {
      icon = '🤝'; title = 'Hòa!'; sub = 'Trận đấu kết thúc hòa.';
    } else if (result.winner) {
      icon = '🏆';
      title = result.winner.username + ' chiến thắng!';
      var reasonMap = { win: 'Thắng 5 quân.', resign: 'Đối thủ đầu hàng.', timeout: 'Đối thủ hết giờ.', disconnect: 'Đối thủ thoát.' };
      sub = reasonMap[result.reason] || '';
    } else {
      icon = '🏁'; title = 'Kết thúc'; sub = '';
    }
    if (result.gameType === 'casual') sub += (sub ? ' ' : '') + '(Giao lưu)';
  } else {
    // Nội dung dành cho người chơi
    // Lấy tên đối thủ từ players hiện tại
    var opponentName = '';
    if (result.winner) {
      var wId = result.winner.userId;
      opponentName = wId === casualPlayerIds.X
        ? ($('po-name') ? $('po-name').textContent : 'Đối thủ')
        : ($('px-name') ? $('px-name').textContent : 'Đối thủ');
    }
    if (result.draw) {
      icon = '🤝'; title = 'Hòa!';
    } else if (result.winner && result.winner.userId === myId) {
      icon = '🏆'; title = 'Chiến thắng!';
      var rm = {
        win: 'Xuất sắc!',
        resign: (opponentName || 'Đối thủ') + ' đầu hàng!',
        timeout: (opponentName || 'Đối thủ') + ' hết giờ!',
        disconnect: (opponentName || 'Đối thủ') + ' thoát!'
      };
      sub = rm[result.reason] || '';
    } else {
      icon = '💔'; title = 'Thất bại';
      var winnerName = result.winner ? result.winner.username : '';
      var rm2 = {
        win: (winnerName || 'Đối thủ') + ' thắng.',
        resign: 'Bạn đã đầu hàng.',
        timeout: 'Bạn hết giờ.',
        disconnect: 'Bạn thoát.'
      };
      sub = rm2[result.reason] || '';
    }
    if (result.gameType === 'casual') sub += (sub ? ' ' : '') + '(Giao lưu — không tính ELO)';
  }

  set('result-icon', icon); set('result-title', title); set('result-sub', sub);

  var row = $('elo-ch'); if (row) row.innerHTML = '';
  if (result.eloChanges && row && Object.keys(result.eloChanges).length) {
    Object.keys(result.eloChanges).forEach(function(uid) {
      var ch = result.eloChanges[uid];
      var name = (currentUser && uid == currentUser.id) ? currentUser.username :
        (result.winner && result.winner.userId == uid ? result.winner.username : 'Đối thủ');
      var chip = document.createElement('div'); chip.className = 'elo-chip';
      var sign = ch.delta >= 0 ? '+' : '';
      chip.innerHTML = esc(name) + ': ' + ch.newElo + ' <span class="' + (ch.delta >= 0 ? 'dp' : 'dn') + '">' + sign + ch.delta + '</span>';
      row.appendChild(chip);
    });
  }

  // Casual score
  if (result.gameType === 'casual' && row && !isSpectator) {
    var chip2 = document.createElement('div'); chip2.className = 'elo-chip';
    var lid = casualPlayerIds._left || casualPlayerIds.X;
    var rid = casualPlayerIds._right || casualPlayerIds.O;
    chip2.innerHTML = '🤝 Tỉ số: <strong>' + (casualScores[lid]||0) + ' – ' + (casualScores[rid]||0) + '</strong>';
    row.appendChild(chip2);
  }

  // Buttons — single authoritative block
  var rab = $('result-action-btn');
  if (rab) {
    rab.style.display = 'none';
    rab._action = null;
    if (!isSpectator) {
      if (result.gameType === 'casual') {
        rab.textContent = rematchVoted ? '⏳ Đang chờ đối thủ...' : '🔄 Tái đấu';
        rab.style.display = 'inline-block';
        rab._action = rematchVoted ? null : playAgain;
      } else if (result.gameType === 'ranked') {
        rab.textContent = '🔍 Tìm trận mới';
        rab.style.display = 'inline-block';
        rab._action = function() { nav('thidau'); cancelMatch && cancelMatch(); findMatch(); };
      }
    }
    // Spectator: không hiện nút gì cả
  }

  $('result-modal').style.display = 'flex';
}

function backLobby() {
  var rm = $('result-modal'); if (rm) rm.style.display = 'none';
  currentRoom = null; isSpectator = false;
  casualScores = {};
  casualPlayerIds = { X: null, O: null, _left: null, _right: null };
  leftPieceCur = 'X'; rightPieceCur = 'O'; // reset về mặc định
  nav('home');
}

function playAgain() {
  var paBtn = $('result-action-btn');
  if (gameType === 'casual' && !isSpectator) {
    if (rematchVoted) return;
    rematchVoted = true;
    if (paBtn) paBtn.textContent = '⏳ Đang chờ đối thủ...';
    if (socket && currentRoom) socket.emit('casual_rematch', { roomCode: currentRoom });
    var rm = $('result-modal'); if (rm) rm.style.display = 'none';
    toast('Đã gửi yêu cầu chơi lại...', 'i');
  } else {
    // Ranked: find new match
    var rm = $('result-modal'); if (rm) rm.style.display = 'none';
    currentRoom = null; isSpectator = false;
    nav('thidau');
    if (socket) socket.emit('join_matchmaking');
  }
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
var _lbShowAll = false;

async function loadLB(showAll) {
  if (showAll !== undefined) _lbShowAll = showAll;
  var tbody = $('lb-body'); if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="lb-load">Đang tải...</td></tr>';
  try {
    var url = _lbShowAll ? '/api/leaderboard?all=1' : '/api/leaderboard?limit=20';
    var fetchOpts = API.token ? { headers: { Authorization: 'Bearer ' + API.token } } : {};
    var res = await Promise.all([
      fetch(url, fetchOpts).then(function(r){ return r.json(); }),
      currentUser ? API.myRank() : Promise.resolve(null)
    ]);
    var lb = res[0].leaderboard || [];
    var totalUsers = res[0].totalUsers || 0;
    var me = res[1] ? res[1].rank : null;
    var med = ['🥇','🥈','🥉'];

    tbody.innerHTML = lb.map(function(p, i) {
      var rk = med[i] || '#' + (i + 1);
      var ec = i < 3 ? ['#f59e0b','#9ca3af','#cd7f32'][i] : '#2d7a4f';
      var isMy = currentUser && p.id === currentUser.id;
      var av = avatarHtml(p.username, p.avatar_url, 'sz36', '');
      return '<tr style="' + (isMy ? 'background:#f0fdf4;' : '') + '">' +
        '<td style="font-weight:700;color:' + ec + ';">' + rk + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px;">' + av +
        '<span style="font-weight:600;">' + esc(p.username) + (isMy ? ' <em style="color:#2d7a4f;font-size:11px;">(bạn)</em>' : '') + (onlineUserIds.has(p.id) ? '<span class="odot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-left:5px;vertical-align:middle;"></span>' : '') + '</span></div></td>' +
        '<td style="text-align:right;color:' + ec + ';font-weight:700;">' + p.elo + '</td>' +
        '<td style="text-align:right;color:#aaa;">' + p.wins + '/' + p.losses + '/' + p.draws + '</td></tr>';
    }).join('');

    // Nút xem thêm / thu gọn
    var moreRow = $('lb-more-row');
    if (moreRow) {
      if (!_lbShowAll && totalUsers > 20) {
        moreRow.innerHTML = '<td colspan="4" style="text-align:center;padding:10px 0;">' +
          '<button onclick="loadLB(true)" style="background:none;border:1.5px solid #2d7a4f;color:#2d7a4f;border-radius:8px;padding:6px 18px;font-family:Montserrat,sans-serif;font-weight:700;font-size:12px;cursor:pointer;">▼ Xem thêm ' + (totalUsers - 20) + ' người</button></td>';
      } else if (_lbShowAll && totalUsers > 20) {
        moreRow.innerHTML = '<td colspan="4" style="text-align:center;padding:10px 0;">' +
          '<button onclick="loadLB(false)" style="background:none;border:1.5px solid #aaa;color:#aaa;border-radius:8px;padding:6px 18px;font-family:Montserrat,sans-serif;font-weight:700;font-size:12px;cursor:pointer;">▲ Thu gọn</button></td>';
      } else {
        moreRow.innerHTML = '';
      }
    }

    // Banner hạng: #32/220
    if (me) {
      var b = $('my-rank-banner');
      if (b) {
        b.style.display = 'flex';
        var avMe = avatarHtml(me.username, me.avatar_url, 'sz42', '');
        var rankStr = 'Hạng #' + me.rank + (me.totalUsers ? '/' + me.totalUsers : '');
        b.innerHTML = avMe + '<div>' +
          '<div style="font-size:15px;font-weight:800;color:#166534;">' + rankStr + '</div>' +
          '<div style="font-size:13px;color:#888;">ELO ' + me.elo + ' · ' + me.wins + 'W ' + me.losses + 'L ' + me.draws + 'D</div></div>';
      }
    }
  } catch(ex) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:#e53e3e;">' + esc(ex.message) + '</td></tr>';
  }
}

// ─── Viewers/Spectators in game ──────────────────────────────────────────────
function updateViewersBar(players, spectators) {
  var bar = $('viewers-bar');
  if (!bar) return;
  var all = [];
  // Add players
  if (players) {
    if (players.X) all.push({ username: players.X.username, avatarUrl: players.X.avatarUrl || '', role: 'X', color: 'av-r' });
    if (players.O) all.push({ username: players.O.username, avatarUrl: players.O.avatarUrl || '', role: 'O', color: 'av-g' });
  }
  // Add spectators
  (spectators || []).forEach(function(s) {
    all.push({ username: s.username, avatarUrl: s.avatarUrl || '', role: '👁', color: '' });
  });

  if (!all.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  var avHtml = all.map(function(p) {
    var init = getInitials(p.username);
    var roleLabel = p.role === 'X' ? '<span style="color:#dc2626;font-size:9px;font-weight:900;">✕</span>'
                  : p.role === 'O' ? '<span style="color:#16a34a;font-size:9px;font-weight:900;">○</span>'
                  : '<span style="font-size:9px;">👁</span>';
    var img = p.avatarUrl
      ? '<img src="' + esc(p.avatarUrl) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.textContent=\'' + esc(init).replace(/'/g,"\\'") + '\'">'
      : init;
    return '<div style="position:relative;flex-shrink:0;">' +
      '<div class="av ' + (p.color || 'av-g') + ' sz36" style="' + (p.color ? '' : 'background:#f0f0f0;border-color:#ccc;color:#888;') + '">' + img + '</div>' +
      '<div style="position:absolute;bottom:-2px;right:-2px;background:#fff;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;border:1px solid #eee;">' + roleLabel + '</div>' +
      '</div>';
  }).join('');

  var cntTxt = spectators && spectators.length ? '<span style="font-size:11px;color:#aaa;margin-left:4px;">+' + spectators.length + ' đang xem</span>' : '';
  bar.innerHTML = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' + avHtml + '</div>' + cntTxt;
}

// ─── Sound ────────────────────────────────────────────────────────────────────
// ─── Audio context (shared) ────────────────────────────────────────────────
var _audioCtx = null;
function getAudio() {
  if (!_audioCtx) _audioCtx = new(window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

// Tiếng "lách" - quân X (tần số cao, nhẹ)
function soundX() {
  try {
    var a = getAudio();
    var buf = a.createBuffer(1, a.sampleRate * 0.06, a.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) {
      var t = i / a.sampleRate;
      var env = Math.exp(-t * 50);
      d[i] = 0.18 * env * Math.sin(2*Math.PI*2200*t);
      d[i] += 0.06 * env * (Math.random()*2-1);
    }
    var src = a.createBufferSource(); src.buffer = buf;
    src.connect(a.destination); src.start();
  } catch(e) {}
}

// Tiếng "cách" - quân O (tần số thấp hơn, đầy hơn)
function soundO() {
  try {
    var a = getAudio();
    var buf = a.createBuffer(1, a.sampleRate * 0.08, a.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) {
      var t = i / a.sampleRate;
      var env = Math.exp(-t * 35);
      d[i] = 0.22 * env * Math.sin(2*Math.PI*1100*t);
      d[i] += 0.08 * env * (Math.random()*2-1);
    }
    var src = a.createBufferSource(); src.buffer = buf;
    src.connect(a.destination); src.start();
  } catch(e) {}
}

// Âm thanh nước đi: "lách" (X) và "cách" (O)
// X: frequency cao hơn, O: frequency thấp hơn
function playMove(piece) {
  try {
    var a = getAudio();
    var buf = a.createBuffer(1, a.sampleRate * 0.06, a.sampleRate);
    var data = buf.getChannelData(0);
    var freq = piece === 'X' ? 1800 : 1100; // X=cao(lách), O=thấp(cách)
    var amp  = piece === 'X' ? 0.18 : 0.22; // biên độ khác nhau
    for (var i = 0; i < data.length; i++) {
      var t = i / a.sampleRate;
      var env = Math.exp(-t * 40); // decay nhanh
      data[i] = amp * env * Math.sin(2 * Math.PI * freq * t);
      // Thêm chút noise để nghe "cứng" như đặt quân cờ
      data[i] += 0.04 * env * (Math.random() * 2 - 1);
    }
    var src = a.createBufferSource();
    src.buffer = buf;
    var g = a.createGain(); g.gain.value = 1;
    src.connect(g); g.connect(a.destination);
    src.start();
  } catch(e) {}
}

// Tiếng lạch cạch đồng hồ (10s cuối đếm ngược)
function beep() {
  try {
    var a = getAudio();
    var sr = a.sampleRate;
    var dur = 0.04; // 40ms - ngắn như kim đồng hồ
    var buf = a.createBuffer(1, sr * dur, sr);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) {
      var t = i / sr;
      var env = Math.exp(-t * 80); // tắt nhanh
      // Tiếng gõ cơ học: noise ngắn + resonance thấp
      d[i] = 0.15 * env * (Math.random() * 2 - 1);
      d[i] += 0.10 * env * Math.sin(2 * Math.PI * 600 * t);
    }
    var src = a.createBufferSource(); src.buffer = buf;
    var g = a.createGain(); g.gain.value = 0.6;
    src.connect(g); g.connect(a.destination); src.start();
  } catch(e) {}
}

// ─── Persist ─────────────────────────────────────────────────────────────────
function saveState() {
  if (over || isSpectator) { sessionStorage.removeItem('vncaro_game'); return; }
  try { sessionStorage.setItem('vncaro_game', JSON.stringify({ room: currentRoom, gameType })); } catch(e) {}
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  var ji = $('join-code');
  if (ji) ji.addEventListener('keydown', function(e) { if (e.key === 'Enter') joinManual(); });

  var token = API.loadToken();
  if (!token) return;
  try {
    var data = await API.me();
    currentUser = data.user;
    connectSocket(token);
    setTimeout(function() {
      try {
        var saved = JSON.parse(sessionStorage.getItem('vncaro_game') || 'null');
        if (saved && saved.room && socket && socket.connected) {
          socket.emit('rejoin_game', { roomCode: saved.room });
        }
      } catch(e) {}
    }, 1200);
  } catch(e) { API.setToken(null); }
})();


window.getBitboardPosition = function() {
    const size = 19;
    let bbX = 0n;
    let bbO = 0n;
    let bbBlock = 0n;

    if (typeof BD === 'undefined' || !BD || typeof FORB === 'undefined' || !FORB) {
        console.error("Game memory not found. Make sure you are in a match.");
        return "0,0,0";
    }

    FORB.forEach(f => {
        const index = BigInt(f[0] * size + f[1]);
        bbBlock |= (1n << index);
    });

    for (let r = 0; r < size; r++) {
        if (!BD[r]) continue;
        for (let c = 0; c < size; c++) {
            const piece = BD[r][c];
            if (piece) {
                const index = BigInt(r * size + c);
                if (piece === 'X') bbX |= (1n << index);
                else if (piece === 'O') bbO |= (1n << index);
            }
        }
    }
    return `${bbX.toString(16)},${bbO.toString(16)},${bbBlock.toString(16)}`;
};

window.parseBitboardToBoard = function(bitboardStr) {
    const parts = bitboardStr.split(',');
    if (parts.length !== 3) {
        console.error("Invalid bitboard string format.");
        return null;
    }
    const bbX = BigInt("0x" + parts[0]);
    const bbO = BigInt("0x" + parts[1]);
    const bbBlock = BigInt("0x" + parts[2]);
    const size = 19;
    let board = [];
    for (let r = 0; r < size; r++) {
        let row = [];
        for (let c = 0; c < size; c++) {
            const index = BigInt(r * size + c);
            const mask = 1n << index;
            if ((bbX & mask) !== 0n) row.push('X');
            else if ((bbO & mask) !== 0n) row.push('O');
            else if ((bbBlock & mask) !== 0n) row.push('#');
            else row.push('.');
        }
        board.push(row);
    }
    return board;
};

window.getBoardTextFromBitboard = function(bitboardStr) {
    const board = window.parseBitboardToBoard(bitboardStr);
    if (!board) return null;
    return board.map(row => row.join(' ')).join('\n');
};

window.debugBoard = function() {
    const bbPos = window.getBitboardPosition();
    const boardStr = window.getBoardTextFromBitboard(bbPos);
    if (boardStr) {
        console.log("Current Board State:\n" + boardStr);
        console.log("\nBitboard Payload: " + bbPos);
    }
};
