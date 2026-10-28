const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;
const rooms = new Map();

function roomCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); }
  while (rooms.has(code));
  return code;
}
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function publicPlayer(p) {
  return { id: p.id, x: p.x, z: p.z, yaw: p.yaw, slot: p.slot };
}
function broadcast(room, data, except) {
  for (const p of room.players.values()) {
    if (p.ws !== except) send(p.ws, data);
  }
}
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Special Ops 3D room server is running');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});
const wss = new WebSocket.Server({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  ws.playerId = Math.random().toString(36).slice(2, 10);
  ws.roomCode = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'پیام نامعتبر است' }); }

    if (msg.type === 'create') {
      if (ws.roomCode) return send(ws, { type: 'error', message: 'قبلاً وارد اتاق شده‌ای' });
      const code = roomCode();
      const room = { code, players: new Map() };
      const player = { id: ws.playerId, ws, slot: 1, x: 0, z: 20, yaw: Math.PI };
      room.players.set(player.id, player);
      rooms.set(code, room);
      ws.roomCode = code;
      return send(ws, { type: 'created', room: code, playerId: player.id, slot: 1, players: [publicPlayer(player)] });
    }

    if (msg.type === 'join') {
      if (ws.roomCode) return send(ws, { type: 'error', message: 'قبلاً وارد اتاق شده‌ای' });
      const code = String(msg.room || '');
      if (!/^\d{6}$/.test(code) || !rooms.has(code)) return send(ws, { type: 'error', message: 'اتاق پیدا نشد؛ کد را بررسی کن' });
      const room = rooms.get(code);
      if (room.players.size >= 2) return send(ws, { type: 'full', message: 'اتاق پر است' });
      const player = { id: ws.playerId, ws, slot: 2, x: 0, z: -20, yaw: 0 };
      room.players.set(player.id, player);
      ws.roomCode = code;
      send(ws, { type: 'joined', room: code, playerId: player.id, slot: 2, players: [...room.players.values()].map(publicPlayer) });
      broadcast(room, { type: 'state', player: publicPlayer(player) }, ws);
      return;
    }

    if (msg.type === 'move') {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const player = room.players.get(ws.playerId);
      if (!player) return;
      const x = Number(msg.x), z = Number(msg.z), yaw = Number(msg.yaw);
      if (![x, z, yaw].every(Number.isFinite)) return;
      // Basic sanity limits; game-specific collision validation can be added later.
      player.x = Math.max(-27, Math.min(27, x));
      player.z = Math.max(-26, Math.min(26, z));
      player.yaw = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      broadcast(room, { type: 'state', player: publicPlayer(player) }, ws);
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players.delete(ws.playerId);
    broadcast(room, { type: 'peer-left' });
    if (room.players.size === 0) rooms.delete(code);
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Special Ops room server listening on ${PORT}`);
});
