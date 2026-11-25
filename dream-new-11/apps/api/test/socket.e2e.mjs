// Socket.IO checks against a running API: auth, room validation, and live pushes.
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:4000';
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`);
};
const call = async (method, path, body, token) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const connect = (token) => io(`${API}/live`, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
const once = (socket, event, ms) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

// Bad token → disconnected.
const bad = connect('not-a-token');
const kicked = await once(bad, 'disconnect', 5000);
check('invalid token is disconnected', kicked !== null);
bad.close();

const login = await call('POST', '/auth/login/email', { email: 'demo@dreamnew11.app', password: 'Demo@1234' });
const token = login.tokens.accessToken;
const s = connect(token);
await once(s, 'connect', 5000);
check('valid token connects', s.connected);

const ack = (room) => new Promise((resolve) => s.emit('subscribe', { room }, resolve));
let r = await ack('nonsense');
check('malformed room refused', r.ok === false);
r = await ack('contest:doesnotexist00000000');
check('unknown contest refused', r.ok === false);

const feed = await call('GET', '/matches/feed?sport=cricket', null, token);
// Prefer a Blitz (a ball every 8s) over a T20 (every 45s) so a push arrives quickly.
const live = feed.live.find((m) => m.format === 'T10') ?? feed.live[0];
if (live) {
  r = await ack(`match:${live.id}`);
  check('subscribe to a live match', r.ok === true);
  const evt = await once(s, 'match:live', 60_000);
  check('received a match:live push within 60s', evt?.matchId === live.id && Array.isArray(evt.score?.innings), JSON.stringify(evt)?.slice(0, 200));
} else {
  console.log('SKIP  no live match right now — live push not checked');
}

s.close();
console.log(`\n${pass} passed, ${fail} failed`);
// Let the websocket finish closing first: exiting mid-close crashes Node on Windows (libuv assertion).
setTimeout(() => process.exit(fail ? 1 : 0), 500);
