import express from 'express';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import multer from 'multer';

import { ServerChoreography } from './server-choreography.js';
import { ServerAudio } from './server-audio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = 3000;
const BAUD_RATE = 115200;

// --- Setup Directories ---
const uploadsDir = join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const choreoPath = join(uploadsDir, 'choreography.json');

// --- Serial Port State ---
let serialPort = null;
let isSerialConnected = false;
let wsClients = new Set();

// --- Sub-Systems ---
const audioManager = new ServerAudio(uploadsDir);

const choreoEngine = new ServerChoreography({
  sendCommand: (cmd) => {
    if (serialPort && serialPort.isOpen) {
      serialPort.write(cmd + '\n', (err) => {
        if (err) console.error('Serial write error:', err.message);
      });
    }
  },
  broadcast: (msg) => broadcast(msg),
  playAudio: (t, s) => audioManager.play(t, s),
  pauseAudio: () => audioManager.pause(),
  seekAudio: (t) => audioManager.seek(t),
  hasAudio: () => audioManager.hasAudio(),
  isAudioPlaying: () => audioManager.state.isPlaying,
  getAudioTime: () => audioManager.getCurrentTime()
});

// --- Load Persistence ---
if (fs.existsSync(choreoPath)) {
  try {
    const saved = JSON.parse(fs.readFileSync(choreoPath, 'utf8'));
    choreoEngine.updateConfig(saved);
    console.log(`✓ Loaded shared choreography: ${saved.fileName || 'Untitled'}`);
  } catch (e) { console.log('No saved choreography.'); }
}

function saveChoreography() {
  const data = {
    choreography: choreoEngine.choreography,
    fileName: 'Synced Project',
    reverseFlags: choreoEngine.reverseFlags,
    motorMapping: choreoEngine.motorMapping,
    frameDimensions: choreoEngine.frameDimensions,
    loopEnabled: choreoEngine.loopEnabled,
    restEnabled: choreoEngine.restEnabled,
    restDuration: choreoEngine.restDuration,
    settings: {
        speed: choreoEngine.maxSpeed,
        accel: choreoEngine.acceleration
    }
  };
  fs.writeFileSync(choreoPath, JSON.stringify(data, null, 2));
}

// --- Serial Port Functions ---
function initSerial(portPath) {
  if (!portPath) return;
  if (serialPort) {
    if (serialPort.path === portPath && serialPort.isOpen) return;
    if (serialPort.isOpen) serialPort.close();
    serialPort.removeAllListeners();
    serialPort = null;
  }

  try {
    serialPort = new SerialPort({ path: portPath, baudRate: BAUD_RATE, autoOpen: false });
    const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    serialPort.open((err) => {
      if (err) {
        console.error(`Error opening ${portPath}:`, err.message);
        isSerialConnected = false;
        broadcast({ type: 'status', connected: false });
        return;
      }
      console.log(`\n✓ Connected to Arduino on ${portPath}`);
      isSerialConnected = true;
      broadcast({ type: 'status', connected: true });
    });

    parser.on('data', (data) => {
      broadcast({ type: 'arduino', message: data.trim() });
    });

    serialPort.on('close', () => {
      console.log('\nSerial port closed.');
      isSerialConnected = false;
      broadcast({ type: 'status', connected: false });
    });

    serialPort.on('error', (err) => {
      console.error('Serial error:', err.message);
      isSerialConnected = false;
      broadcast({ type: 'status', connected: false });
    });
  } catch (e) {
    console.error('Serial Init Failed:', e.message);
  }
}

function broadcast(msg) {
  const str = JSON.stringify(msg);
  wsClients.forEach(c => {
    if (c.readyState === 1) c.send(str);
  });
}

// --- Express App ---
const app = express();
app.use(express.static(__dirname));
app.use(express.json());

// Audio Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    cb(null, 'current-audio' + (ext ? '.' + ext : ''));
  }
});
const upload = multer({ storage });

app.post('/api/audio/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const result = audioManager.handleUpload(req.file);
    broadcast(audioManager.getStatus());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/audio/status', (req, res) => res.json(audioManager.getStatus()));
app.get('/api/ports', async (req, res) => res.json(await SerialPort.list()));

app.post('/api/connect', (req, res) => {
  const { port } = req.body;
  if (!port) return res.status(400).json({ error: 'Port required' });
  initSerial(port);
  res.json({ success: true });
});

app.post('/api/command', (req, res) => {
  const { command } = req.body;
  if (serialPort && serialPort.isOpen) {
    serialPort.write(command + '\n');
    res.json({ success: true });
  } else {
    res.status(503).json({ error: 'Not connected' });
  }
});

// --- Start Server ---
const server = app.listen(PORT, () => {
  console.log(`\n✓ Server running at http://localhost:${PORT}`);
});

// --- WebSocket ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log('Client connected');

  // Initial Sync
  ws.send(JSON.stringify({ type: 'status', connected: isSerialConnected }));
  ws.send(JSON.stringify(audioManager.getStatus()));
  ws.send(JSON.stringify({
    type: 'choreographySync',
    choreography: choreoEngine.choreography,
    reverseFlags: choreoEngine.reverseFlags,
    motorMapping: choreoEngine.motorMapping,
    frameDimensions: choreoEngine.frameDimensions,
    loopEnabled: choreoEngine.loopEnabled,
    restEnabled: choreoEngine.restEnabled,
    restDuration: choreoEngine.restDuration,
    settings: {
        speed: choreoEngine.maxSpeed,
        accel: choreoEngine.acceleration
    }
  }));
  ws.send(JSON.stringify(choreoEngine.getStatus()));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'playChoreography') {
        choreoEngine.play(data.startTime || 0, data.speed || 1.0);
      }
      else if (data.type === 'stopChoreography') {
        choreoEngine.stop();
      }
      else if (data.type === 'pauseChoreography') {
        choreoEngine.pause();
      }
      else if (data.type === 'choreographyUpdate') {
        choreoEngine.updateConfig(data);
        saveChoreography();
      }
      else if (data.type === 'getChoreography') {
        ws.send(JSON.stringify({
           type: 'choreographySync',
           choreography: choreoEngine.choreography,
           reverseFlags: choreoEngine.reverseFlags,
           motorMapping: choreoEngine.motorMapping,
           frameDimensions: choreoEngine.frameDimensions,
           loopEnabled: choreoEngine.loopEnabled,
           restEnabled: choreoEngine.restEnabled,
           restDuration: choreoEngine.restDuration,
           settings: {
               speed: choreoEngine.maxSpeed,
               accel: choreoEngine.acceleration
           }
        }));
      }
      else if (data.type === 'audio') {
        // Direct Audio Control
        if (data.action === 'play') audioManager.play(data.time, data.speed);
        if (data.action === 'pause') audioManager.pause();
        if (data.action === 'seek') audioManager.seek(data.time);
        if (data.action === 'setVolume') {
           audioManager.setVolume(data.volume);
           broadcast(audioManager.getStatus());
        }
      }
      else if (data.type === 'command') {
        if (serialPort && serialPort.isOpen) serialPort.write(data.command + '\n');
      }

    } catch (e) { console.error('WS Message Error:', e); }
  });

  ws.on('close', () => wsClients.delete(ws));
});

// --- Heartbeats ---
setInterval(() => {
  if (isSerialConnected && serialPort && serialPort.isOpen) serialPort.write('P\n', () => {});
}, 1000);

setInterval(() => {
  if (audioManager.state.isPlaying) broadcast(audioManager.getStatus());
}, 500);

process.on('SIGINT', () => {
  audioManager.stopProcess();
  if (serialPort && serialPort.isOpen) serialPort.close();
  process.exit(0);
});
