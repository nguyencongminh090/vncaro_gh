'use strict';
const API = {
  token: null,
  setToken(t) { this.token = t; if(t) localStorage.setItem('vncaro_token',t); else localStorage.removeItem('vncaro_token'); },
  loadToken() { this.token = localStorage.getItem('vncaro_token'); return this.token; },
  async request(method, url, body) {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Lỗi không xác định');
    return d;
  },
  get(url) { return this.request('GET', url); },
  post(url, b) { return this.request('POST', url, b); },
  register(u, p) { return this.post('/api/auth/register', { username: u, password: p }); },
  login(u, p) { return this.post('/api/auth/login', { username: u, password: p }); },
  loginGoogle(credential) { return this.post('/api/auth/google', { credential }); },
  me() { return this.get('/api/auth/me'); },
  leaderboard(limit) { return this.get('/api/leaderboard?limit=' + (limit||50)); },
  myRank() { return this.get('/api/leaderboard/me'); }
};
