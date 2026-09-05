// Live Screen Share Signaling & Room Management API
// Handles room creation, WebRTC signal exchange (offer, answer, ice-candidates, chat),
// peer polling, and active room lifecycle.

// In-memory room store (persists during process lifetime)
// Structure:
// rooms[roomId] = {
//   roomId: 'EW-482931',
//   roomName: 'Live Screen Share',
//   hostPeerId: 'host_xyz',
//   hostToken: 'token_abc',
//   createdAt: timestamp,
//   lastActivity: timestamp,
//   active: true,
//   hasAudio: false,
//   viewers: { [viewerPeerId]: { lastSeen: timestamp } },
//   signals: [ { id, fromPeerId, toPeerId, type, data, timestamp } ]
// }

const globalRooms = global.__DONTCBOARD_ROOMS || (global.__DONTCBOARD_ROOMS = new Map());

// Clean up inactive rooms after 15 minutes of inactivity
function cleanupInactiveRooms() {
  const now = Date.now();
  const MAX_INACTIVE_MS = 15 * 60 * 1000; // 15 mins
  for (const [roomId, room] of globalRooms.entries()) {
    if (now - room.lastActivity > MAX_INACTIVE_MS || !room.active) {
      if (now - room.lastActivity > 60 * 60 * 1000) {
        globalRooms.delete(roomId);
      }
    }
  }
}

// Generate random 6-digit room code with EW- prefix
function generateRoomId() {
  let roomId;
  let attempts = 0;
  do {
    const num = Math.floor(100000 + Math.random() * 900000);
    roomId = `EW-${num}`;
    attempts++;
  } while (globalRooms.has(roomId) && globalRooms.get(roomId).active && attempts < 20);
  return roomId;
}

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Host-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  cleanupInactiveRooms();

  let action = '';
  let query = req.query || {};
  if (req.url && req.url.includes('?')) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      urlObj.searchParams.forEach((v, k) => { query[k] = v; });
    } catch (e) {}
  }
  action = query.action || '';

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!body) body = {};

  if (!action && body.action) {
    action = body.action;
  }

  try {
    // ── 1. CREATE ROOM ──────────────────────────────────────────
    if (action === 'create-room' || (req.method === 'POST' && action === 'create')) {
      const requestedId = (body.roomId || query.roomId || '').trim().toUpperCase();
      const hostPeerId = body.hostPeerId || `host_${generateToken()}`;
      const roomName = (body.roomName || 'Live Screen Share').substring(0, 50);
      const hasAudio = !!body.hasAudio;

      let roomId = requestedId;
      if (!roomId || !/^EW-[A-Z0-9]{4,10}$/i.test(roomId)) {
        roomId = generateRoomId();
      }

      const hostToken = generateToken();
      const now = Date.now();

      const room = {
        roomId,
        roomName,
        hostPeerId,
        hostToken,
        createdAt: now,
        lastActivity: now,
        active: true,
        hasAudio,
        viewers: {},
        signals: []
      };

      globalRooms.set(roomId, room);

      return res.status(200).json({
        success: true,
        roomId,
        hostPeerId,
        hostToken,
        createdAt: now
      });
    }

    // ── 2. GET ROOM STATUS ──────────────────────────────────────
    if (action === 'get-room' || (req.method === 'GET' && query.roomId && !query.peerId)) {
      const rawId = (query.roomId || body.roomId || '').trim().toUpperCase();
      if (!rawId) {
        return res.status(400).json({ error: 'Missing roomId parameter' });
      }

      const room = globalRooms.get(rawId);
      if (!room || !room.active) {
        return res.status(200).json({
          exists: false,
          roomId: rawId,
          active: false,
          message: 'Live session not found or has ended'
        });
      }

      const now = Date.now();
      // Count active viewers (seen in last 20 seconds)
      let viewerCount = 0;
      for (const [vId, vData] of Object.entries(room.viewers)) {
        if (now - vData.lastSeen < 20000) {
          viewerCount++;
        }
      }

      return res.status(200).json({
        exists: true,
        active: room.active,
        roomId: room.roomId,
        roomName: room.roomName,
        hostPeerId: room.hostPeerId,
        hasAudio: room.hasAudio,
        viewerCount,
        createdAt: room.createdAt
      });
    }

    // ── 3. SEND SIGNAL (Offer, Answer, ICE candidate, Chat, Join, Leave, End) ─
    if (action === 'signal' || (req.method === 'POST' && body.type)) {
      const { roomId, fromPeerId, toPeerId, type, data, hostToken } = body;
      if (!roomId || !fromPeerId || !type) {
        return res.status(400).json({ error: 'Missing required signal fields: roomId, fromPeerId, type' });
      }

      const room = globalRooms.get(roomId.toUpperCase());
      if (!room || !room.active) {
        return res.status(404).json({ error: 'Live session not found or has ended' });
      }

      const now = Date.now();
      room.lastActivity = now;

      // Handle viewer join
      if (type === 'join') {
        room.viewers[fromPeerId] = { lastSeen: now };
      }

      // Handle viewer leave
      if (type === 'leave') {
        delete room.viewers[fromPeerId];
      }

      // Handle heartbeat / keepalive
      if (type === 'heartbeat') {
        if (fromPeerId === room.hostPeerId) {
          room.lastActivity = now;
        } else if (room.viewers[fromPeerId]) {
          room.viewers[fromPeerId].lastSeen = now;
        }
        return res.status(200).json({ success: true, active: room.active });
      }

      // Handle end session
      if (type === 'end-session') {
        // Verify host token if provided, or verify fromPeerId is host
        if (fromPeerId === room.hostPeerId || (hostToken && hostToken === room.hostToken)) {
          room.active = false;
          room.lastActivity = now;
          // Add end session signal for all viewers
          room.signals.push({
            id: `sig_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            fromPeerId,
            toPeerId: 'all',
            type: 'end-session',
            data: { reason: data?.reason || 'Host ended the session' },
            timestamp: now
          });
          return res.status(200).json({ success: true, message: 'Session ended' });
        }
      }

      // Store signal in room queue (keep last 200 signals)
      const signalId = `sig_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const signalItem = {
        id: signalId,
        fromPeerId,
        toPeerId: toPeerId || 'all',
        type,
        data,
        timestamp: now
      };

      room.signals.push(signalItem);
      if (room.signals.length > 200) {
        room.signals.splice(0, room.signals.length - 200);
      }

      return res.status(200).json({ success: true, signalId });
    }

    // ── 4. POLL SIGNALS ─────────────────────────────────────────
    if (action === 'poll' || (req.method === 'GET' && query.roomId && query.peerId)) {
      const rawId = (query.roomId || '').trim().toUpperCase();
      const peerId = query.peerId;
      const since = parseInt(query.since || '0', 10);

      if (!rawId || !peerId) {
        return res.status(400).json({ error: 'Missing roomId or peerId parameter' });
      }

      const room = globalRooms.get(rawId);
      if (!room) {
        return res.status(200).json({
          active: false,
          signals: [{ type: 'end-session', data: { reason: 'Room not found' } }],
          viewerCount: 0
        });
      }

      const now = Date.now();
      room.lastActivity = now;

      // Update peer heartbeat
      if (peerId === room.hostPeerId) {
        // Host active
      } else {
        if (!room.viewers[peerId]) room.viewers[peerId] = { lastSeen: now };
        room.viewers[peerId].lastSeen = now;
      }

      // Filter signals directed to this peer (or broadcast to 'all') and newer than 'since'
      const relevantSignals = room.signals.filter(s => {
        return s.timestamp > since && s.fromPeerId !== peerId && (s.toPeerId === peerId || s.toPeerId === 'all');
      });

      // Calculate viewer count
      let viewerCount = 0;
      for (const [vId, vData] of Object.entries(room.viewers)) {
        if (now - vData.lastSeen < 20000) {
          viewerCount++;
        }
      }

      return res.status(200).json({
        active: room.active,
        signals: relevantSignals,
        viewerCount,
        timestamp: now
      });
    }

    // ── 5. END ROOM (Host explicit termination) ─────────────────
    if (action === 'end-room') {
      const roomId = (body.roomId || query.roomId || '').trim().toUpperCase();
      const hostToken = body.hostToken || query.hostToken || req.headers['x-host-token'];

      const room = globalRooms.get(roomId);
      if (room) {
        if (!hostToken || hostToken === room.hostToken) {
          room.active = false;
          room.signals.push({
            id: `sig_${Date.now()}`,
            fromPeerId: room.hostPeerId,
            toPeerId: 'all',
            type: 'end-session',
            data: { reason: 'Host closed the live session' },
            timestamp: Date.now()
          });
          return res.status(200).json({ success: true, message: 'Room terminated' });
        }
      }
      return res.status(200).json({ success: true });
    }

    // ── 6. LIST ACTIVE ROOMS (Optional public discovery) ────────
    if (action === 'list-rooms') {
      const activeRooms = [];
      const now = Date.now();
      for (const [roomId, room] of globalRooms.entries()) {
        if (room.active && now - room.lastActivity < 60000) {
          let count = 0;
          for (const [, v] of Object.entries(room.viewers)) {
            if (now - v.lastSeen < 20000) count++;
          }
          activeRooms.push({
            roomId: room.roomId,
            roomName: room.roomName,
            viewerCount: count,
            createdAt: room.createdAt,
            hasAudio: room.hasAudio
          });
        }
      }
      return res.status(200).json({ rooms: activeRooms });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Error in live signaling API:', err);
    return res.status(500).json({ error: err.message || 'Internal server error in live signaling' });
  }
};
