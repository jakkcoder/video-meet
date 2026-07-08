const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const GCS_BUCKET = process.env.GCS_BUCKET || 'gharkaguru-website';
const GCS_RECORDINGS_FOLDER = process.env.GCS_RECORDINGS_FOLDER || 'meeting records';
const RECORDINGS_DIR = path.join(os.tmpdir(), 'recordings');
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

const storage = new Storage();

function createRoom(roomId) {
  return {
    participants: [],
    allParticipantNames: new Set(),
    createdAt: Date.now(),
    endedAt: null
  };
}

function getRoomDir(roomId) {
  const safeRoomId = roomId.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(RECORDINGS_DIR, safeRoomId);
}

function sanitizeName(name) {
  return (name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
}

async function pushRecordingsToGCS(roomId, room) {
  const roomDir = getRoomDir(roomId);
  if (!fs.existsSync(roomDir)) return;

  const files = fs.readdirSync(roomDir).filter(f => !f.startsWith('.'));
  if (files.length === 0) {
    fs.rmSync(roomDir, { recursive: true, force: true });
    return;
  }

  const endedAt = room.endedAt || new Date();
  const datetime = endedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const participants = Array.from(room.allParticipantNames).map(sanitizeName).join('-') || 'no-participants';
  const safeRoomId = roomId.replace(/[^a-zA-Z0-9-_]/g, '_');
  const bucket = storage.bucket(GCS_BUCKET);

  for (const file of files) {
    const localPath = path.join(roomDir, file);
    const ext = path.extname(file) || '.webm';
    const recordedBy = file.split('-')[0] || 'unknown';
    const gcsFilename = `${datetime}_${participants}_${safeRoomId}_${recordedBy}${ext}`;
    const gcsPath = `${GCS_RECORDINGS_FOLDER}/${safeRoomId}/${gcsFilename}`;

    try {
      await bucket.upload(localPath, {
        destination: gcsPath,
        metadata: {
          contentType: 'video/webm',
          metadata: {
            roomId,
            datetime: endedAt.toISOString(),
            participants: Array.from(room.allParticipantNames).join(', '),
            recordedBy,
            meetingEndedAt: endedAt.toISOString()
          }
        }
      });
      console.log(`Recording pushed to GCS: gs://${GCS_BUCKET}/${gcsPath}`);
      fs.unlinkSync(localPath);
    } catch (err) {
      console.error(`Failed to push ${file} to GCS:`, err);
    }
  }

  fs.rmSync(roomDir, { recursive: true, force: true });
  console.log(`Cleaned local recordings for room ${roomId}`);
}

async function finalizeMeeting(roomId, room) {
  room.endedAt = new Date();
  await pushRecordingsToGCS(roomId, room);
}

const stageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

const app = express();
const server = http.createServer(app);
const socketPath = BASE_PATH ? `${BASE_PATH}/socket.io` : '/socket.io';
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  path: socketPath
});

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const rooms = new Map();
const scheduledMeetings = new Map();

function serveIndex(_req, res) {
  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  html = html.replace(/\{\{BASE_PATH\}\}/g, BASE_PATH);
  res.type('html').send(html);
}

function registerRoutes(router) {
  router.use(express.json());

  router.get('/api/create-room', (req, res) => {
    const roomId = uuidv4().split('-').slice(0, 3).join('-');
    rooms.set(roomId, createRoom(roomId));
    res.json({ roomId });
  });

  router.post('/api/meetings', (req, res) => {
    const { title, description, scheduledTime, duration, hostName } = req.body;
    const sessionId = `meet-${uuidv4().split('-').slice(0, 3).join('-')}`;

    const meeting = {
      sessionId,
      title: title || 'Untitled Meeting',
      description: description || '',
      scheduledTime: scheduledTime || Date.now(),
      duration: duration || 60,
      hostName: hostName || 'Host',
      createdAt: Date.now(),
      status: 'scheduled',
      participantCount: 0
    };

    scheduledMeetings.set(sessionId, meeting);
    rooms.set(sessionId, createRoom(sessionId));
    res.json({ success: true, meeting });
  });

  router.get('/api/meetings', (req, res) => {
    const meetings = Array.from(scheduledMeetings.values())
      .sort((a, b) => a.scheduledTime - b.scheduledTime);

    meetings.forEach(m => {
      const room = rooms.get(m.sessionId);
      m.participantCount = room ? room.participants.length : 0;
      if (m.participantCount > 0) m.status = 'active';
    });

    res.json({ meetings });
  });

  router.get('/api/meetings/:sessionId', (req, res) => {
    const meeting = scheduledMeetings.get(req.params.sessionId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    const room = rooms.get(meeting.sessionId);
    meeting.participantCount = room ? room.participants.length : 0;
    if (meeting.participantCount > 0) meeting.status = 'active';
    res.json({ meeting });
  });

  router.delete('/api/meetings/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (scheduledMeetings.has(sessionId)) {
      scheduledMeetings.delete(sessionId);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Meeting not found' });
    }
  });

  router.get('/api/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) {
      return res.json({ exists: false, participants: 0 });
    }
    res.json({ exists: true, participants: room.participants.length });
  });

  router.post('/api/recordings/stage', stageUpload.single('recording'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No recording file provided' });
      }

      const { roomId, recordedBy } = req.body;
      const safeRoomId = (roomId || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '_');
      const roomDir = getRoomDir(safeRoomId);
      fs.mkdirSync(roomDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const ext = path.extname(req.file.originalname) || '.webm';
      const filename = `${sanitizeName(recordedBy)}-${timestamp}${ext}`;
      const localPath = path.join(roomDir, filename);

      fs.writeFileSync(localPath, req.file.buffer);
      console.log(`Recording staged locally: ${localPath} (room: ${roomId}, by: ${recordedBy})`);

      res.json({
        success: true,
        staged: true,
        localPath,
        message: 'Recording saved locally. Will upload to cloud when meeting ends.'
      });
    } catch (err) {
      console.error('Failed to stage recording:', err);
      res.status(500).json({ error: 'Failed to stage recording', message: err.message });
    }
  });

  router.get('*', serveIndex);
}

if (BASE_PATH) {
  const router = express.Router();
  router.use(express.static(PUBLIC_DIR, { index: false }));
  registerRoutes(router);
  app.use(BASE_PATH, router);
  app.get('/', (_req, res) => res.redirect(BASE_PATH));
} else {
  app.use(express.static(PUBLIC_DIR, { index: false }));
  registerRoutes(app);
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  socket.on('join-room', ({ roomId, userName }) => {
    if (!roomId) return;

    if (currentRoom && rooms.has(currentRoom)) {
      const prev = rooms.get(currentRoom);
      prev.participants = prev.participants.filter(p => p.id !== socket.id);
      socket.leave(currentRoom);
      socket.to(currentRoom).emit('user-left', { userId: socket.id });
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoom(roomId));
    }

    currentRoom = roomId;
    currentUser = { id: socket.id, name: userName || 'Guest' };

    const room = rooms.get(roomId);
    room.participants = room.participants.filter(p => p.id !== socket.id);
    room.participants.push(currentUser);
    room.allParticipantNames.add(currentUser.name);
    socket.join(roomId);

    socket.emit('room-users', room.participants.filter(p => p.id !== socket.id));
    socket.to(roomId).emit('user-joined', currentUser);
  });

  const isPeerInRoom = (targetId) => {
    if (!currentRoom || !rooms.has(currentRoom)) return false;
    return rooms.get(currentRoom).participants.some(p => p.id === targetId);
  };

  socket.on('offer', ({ to, offer }) => {
    if (!isPeerInRoom(to)) return;
    io.to(to).emit('offer', { from: socket.id, offer, userName: currentUser?.name });
  });

  socket.on('answer', ({ to, answer }) => {
    if (!isPeerInRoom(to)) return;
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    if (!isPeerInRoom(to)) return;
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('chat-message', ({ message, userName }) => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    io.to(currentRoom).emit('chat-message', {
      id: uuidv4(),
      message,
      userName: userName || currentUser?.name || 'Guest',
      timestamp: Date.now()
    });
  });

  socket.on('toggle-media', ({ type, enabled }) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('user-toggle-media', {
      userId: socket.id,
      type,
      enabled
    });
  });

  socket.on('screen-share-started', () => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('user-screen-share', { userId: socket.id, sharing: true });
  });

  socket.on('screen-share-stopped', () => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('user-screen-share', { userId: socket.id, sharing: false });
  });

  socket.on('disconnect', async () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;

    const roomId = currentRoom;
    const room = rooms.get(roomId);
    room.participants = room.participants.filter(p => p.id !== socket.id);
    socket.to(roomId).emit('user-left', { userId: socket.id });

    if (room.participants.length === 0) {
      console.log(`Meeting ended: ${roomId}, participants: ${Array.from(room.allParticipantNames).join(', ')}`);
      await finalizeMeeting(roomId, room);
      rooms.delete(roomId);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.length === 0 && now - room.createdAt > 1800000) {
      finalizeMeeting(roomId, room).then(() => rooms.delete(roomId));
    }
  }
}, 1800000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Base path: ${BASE_PATH || '/'}`);
  console.log(`Socket.IO path: ${socketPath}`);
  console.log(`Local recordings dir: ${RECORDINGS_DIR}`);
});
