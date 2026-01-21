import express from 'express';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import multer from 'multer';
import { ServerChoreography } from './server-choreography.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// mpv IPC socket path
const MPV_SOCKET = '/tmp/mpv-socket';

// Audio playback state
let audioProcess = null;
let audioFilePath = null;
let audioState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  fileName: null,
  playbackSpeed: 1.0,
  volume: 100
};
let audioStartTime = 0;
let audioStartOffset = 0;

// Serial Port State
let currentSerialPort = null;
const BAUD_RATE = 115200;
let serialPort = null;
let parser = null;
let wsClients = new Set();
let isSerialConnected = false;

// Ensure uploads directory exists at startup
const uploadsDir = join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Persisted Choreography Path
const choreoPath = join(__dirname, 'uploads', 'choreography.json');

// Initialize Choreography Engine
const choreoEngine = new ServerChoreography({
  sendCommand: (cmd) => {
    if (serialPort && serialPort.isOpen) {
      serialPort.write(cmd + '\n', (err) => {
        if (err) console.error('Serial write error:', err.message);
      });
    }
  },
  broadcast: (msg) => {
    const str = JSON.stringify(msg);
    wsClients.forEach(client => {
      if (client.readyState === 1) client.send(str);
    });
  },
  playAudio: (t, s) => playAudio(t, s),
  pauseAudio: () => pauseAudio(),
  seekAudio: (t) => seekAudio(t),
  hasAudio: () => !!audioFilePath && fs.existsSync(audioFilePath),
  isAudioPlaying: () => audioState.isPlaying,
  getAudioTime: () => getCurrentAudioTime()
});

// Load choreography from file on startup
if (fs.existsSync(choreoPath)) {
  try {
    const savedData = JSON.parse(fs.readFileSync(choreoPath, 'utf8'));
    choreoEngine.updateConfig(savedData);
    console.log(`✓ Loaded shared choreography: ${savedData.fileName || 'Untitled'}`);
  } catch (e) {
    console.log('No saved choreography found, starting fresh');
  }
}

function saveSharedChoreography() {
  const data = {
    choreography: choreoEngine.choreography,
    fileName: 'Synced Project', // We might want to persist the name
    reverseFlags: choreoEngine.reverseFlags,
    motorMapping: choreoEngine.motorMapping
  };
  fs.writeFileSync(choreoPath, JSON.stringify(data, null, 2));
}

// Configure multer for audio uploads
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'current-audio' + getExtension(file.originalname));
  }
});

function getExtension(filename) {
  const ext = filename.split('.').pop();
  return ext ? '.' + ext : '.mp3';
}

const upload = multer({ storage: audioStorage });

const AUDIO_CONFIG_PATH = join(__dirname, 'uploads', 'audio-config.json');

// Load persisted audio config on startup
function loadAudioConfig() {
  try {
    if (fs.existsSync(AUDIO_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8'));
      if (config.filePath && fs.existsSync(config.filePath)) {
        audioFilePath = config.filePath;
        audioState.fileName = config.fileName;
        audioState.duration = config.duration || 0;
        console.log(`✓ Loaded persisted audio: ${config.fileName}`);
        return true;
      }
    }
  } catch (e) {
    console.error('Error loading audio config:', e.message);
  }
  return false;
}

function saveAudioConfig() {
  try {
    const uploadDir = join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    fs.writeFileSync(AUDIO_CONFIG_PATH, JSON.stringify({
      filePath: audioFilePath,
      fileName: audioState.fileName,
      duration: audioState.duration
    }, null, 2));
  } catch (e) {
    console.error('Error saving audio config:', e.message);
  }
}

// Audio playback control functions
function stopAudioProcess() {
  if (audioProcess) {
    audioProcess.kill('SIGTERM');
    audioProcess = null;
  }
  audioState.isPlaying = false;
  // Clean up socket file
  if (fs.existsSync(MPV_SOCKET)) {
    try { fs.unlinkSync(MPV_SOCKET); } catch (e) { }
  }
}

// Send command to mpv via IPC socket
function sendMpvCommand(command) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(MPV_SOCKET)) {
      return reject(new Error('mpv socket not found'));
    }
    const client = net.createConnection(MPV_SOCKET);
    client.on('connect', () => {
      client.write(JSON.stringify(command) + '\n');
      client.end();
      resolve();
    });
    client.on('error', reject);
  });
}

function setMpvVolume(volume) {
  sendMpvCommand({ command: ['set_property', 'volume', volume] })
    .then(() => console.log(`[Audio] Volume set to ${volume}`))
    .catch(err => console.log('[Audio] Could not set volume via IPC:', err.message));
}

function playAudio(startTime = 0, speed = 1.0) {
  console.log(`[Audio] playAudio called: startTime=${startTime}, speed=${speed}`);
  console.log(`[Audio] Audio file path: "${audioFilePath}"`);

  if (!audioFilePath) {
    console.error('[Audio] No audio file path set');
    return false;
  }

  if (!fs.existsSync(audioFilePath)) {
    console.error('[Audio] Audio file does not exist at path:', audioFilePath);
    return false;
  }

  stopAudioProcess();

  audioState.playbackSpeed = speed;
  audioStartOffset = startTime;
  audioStartTime = Date.now();

  // Try mpv first (common on Pi), fallback to ffplay
  // Clean up old socket if exists
  if (fs.existsSync(MPV_SOCKET)) {
    try { fs.unlinkSync(MPV_SOCKET); } catch (e) { }
  }

  const mpvArgs = [
    '--no-video',
    '--no-terminal',
    `--input-ipc-server=${MPV_SOCKET}`,
    `--start=${startTime}`,
    `--speed=${speed}`,
    `--volume=${audioState.volume}`,
    audioFilePath
  ];

  console.log('[Audio] Spawning mpv with args:', mpvArgs);

  // Try mpv first
  audioProcess = spawn('mpv', mpvArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  if (audioProcess.stdout) {
    audioProcess.stdout.on('data', (data) => {
      console.log('[Audio] mpv stdout:', data.toString().trim());
    });
  }

  if (audioProcess.stderr) {
    audioProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error('[Audio] mpv stderr:', msg);
    });
  }

  audioProcess.on('error', (err) => {
    console.error('[Audio] mpv spawn error:', err.message);
    if (err.code === 'ENOENT') {
      // mpv not found, try ffplay
      console.log('[Audio] mpv not found, trying ffplay...');

      const ffplayArgs = [
        '-nodisp',
        '-autoexit',
        '-ss', String(startTime),
        '-af', `atempo=${speed}`,
        '-loglevel', 'error',
        audioFilePath
      ];

      audioProcess = spawn('ffplay', ffplayArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      if (audioProcess.stderr) {
        audioProcess.stderr.on('data', (data) => {
          console.error('[Audio] ffplay stderr:', data.toString().trim());
        });
      }

      audioProcess.on('error', (err2) => {
        console.error('[Audio] ffplay error:', err2.message);
        audioState.isPlaying = false;
        broadcastAudioState();
      });

      audioProcess.on('exit', (code) => {
        console.log(`[Audio] ffplay process exited with code ${code}`);
        audioState.isPlaying = false;
        broadcastAudioState();
      });
    } else {
      audioState.isPlaying = false;
      broadcastAudioState();
    }
  });

  audioProcess.on('exit', (code, signal) => {
    console.log(`[Audio] mpv process exited with code ${code}, signal ${signal}`);
    audioState.isPlaying = false;
    broadcastAudioState();
  });

  audioState.isPlaying = true;
  console.log('[Audio] Audio playback initiated, broadcasting state');
  broadcastAudioState();
  return true;
}

function pauseAudio() {
  if (audioProcess) {
    // Calculate current time before stopping
    const elapsed = (Date.now() - audioStartTime) / 1000 * audioState.playbackSpeed;
    audioState.currentTime = audioStartOffset + elapsed;
    stopAudioProcess();
    broadcastAudioState();
  }
}

function seekAudio(time) {
  audioState.currentTime = time;
  if (audioState.isPlaying) {
    playAudio(time, audioState.playbackSpeed);
  } else {
    audioStartOffset = time;
    broadcastAudioState();
  }
}

function getCurrentAudioTime() {
  if (audioState.isPlaying) {
    const elapsed = (Date.now() - audioStartTime) / 1000 * audioState.playbackSpeed;
    return audioStartOffset + elapsed;
  }
  return audioState.currentTime;
}

function broadcastAudioState() {
  const state = {
    type: 'audioState',
    isPlaying: audioState.isPlaying,
    currentTime: getCurrentAudioTime(),
    fileName: audioState.fileName,
    duration: audioState.duration,
    playbackSpeed: audioState.playbackSpeed,
    volume: audioState.volume
  };
  wsClients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(state));
    }
  });
}

const app = express();
const PORT = 3000;

// Initialize serial connection
function initSerial(portPath) {
  if (!portPath) return;

  if (serialPort) {
    if (serialPort.path === portPath && serialPort.isOpen) {
      console.log(`Already connected to ${portPath}`);
      return;
    }

    console.log('Closing existing connection...');
    if (serialPort.isOpen) {
      serialPort.close();
    }
    serialPort.removeAllListeners();
    if (parser) parser.removeAllListeners();
    serialPort = null;
    parser = null;
  }

  currentSerialPort = portPath;

  try {
    serialPort = new SerialPort({
      path: portPath,
      baudRate: BAUD_RATE,
      autoOpen: false
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    serialPort.open((err) => {
      if (err) {
        console.error(`Error opening ${portPath}:`, err.message);
        isSerialConnected = false;
        broadcastStatus(false);
        return;
      }

      console.log(`\n✓ Connected to Arduino on ${portPath}`);
      isSerialConnected = true;
      broadcastStatus(true);
    });

    parser.on('data', (data) => {
      const message = data.trim();
      wsClients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'arduino',
            message: message
          }));
        }
      });
    });

    serialPort.on('error', (err) => {
      console.error('Serial port error:', err.message);
      isSerialConnected = false;
      broadcastStatus(false);
    });

    serialPort.on('close', () => {
      console.log('\nSerial port closed.');
      isSerialConnected = false;
      broadcastStatus(false);
    });

  } catch (error) {
    console.error('Failed to initialize serial:', error.message);
    isSerialConnected = false;
    broadcastStatus(false);
  }
}

function broadcastStatus(connected) {
  wsClients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({
        type: 'status',
        connected: connected
      }));
    }
  });
}

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// API Endpoints
app.get('/api/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json(ports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connect', (req, res) => {
  const { port } = req.body;
  if (!port) return res.status(400).json({ error: 'Port is required' });
  initSerial(port);
  res.json({ success: true, message: `Connecting to ${port}...` });
});

app.post('/api/command', (req, res) => {
  const { command } = req.body;
  if (!serialPort || !serialPort.isOpen) {
    return res.status(503).json({ error: 'Serial port not connected' });
  }
  serialPort.write(command + '\n', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/audio/upload', (req, res, next) => {
  upload.single('audio')(req, res, (err) => {
    if (err) return res.status(500).json({ error: 'Upload failed: ' + err.message });
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    try {
      const files = fs.readdirSync(uploadsDir);
      files.forEach(f => {
        if (f.startsWith('current-audio') && f !== req.file.filename) {
          fs.unlinkSync(join(uploadsDir, f));
        }
      });

      audioFilePath = req.file.path;
      audioState.fileName = req.file.originalname;
      audioState.currentTime = 0;
      audioState.isPlaying = false;
      saveAudioConfig();
      broadcastAudioState();

      console.log(`✓ Audio uploaded: ${req.file.originalname}`);
      res.json({ success: true, fileName: req.file.originalname });
    } catch (e) {
      res.status(500).json({ error: 'Error processing upload: ' + e.message });
    }
  });
});

app.get('/api/audio/status', (req, res) => {
  res.json({
    fileName: audioState.fileName,
    isPlaying: audioState.isPlaying,
    currentTime: getCurrentAudioTime(),
    duration: audioState.duration,
    hasAudio: !!audioFilePath && fs.existsSync(audioFilePath)
  });
});

// List ports
SerialPort.list().then(ports => {
  console.log('\n=== Available Serial Ports ===');
  if (ports.length === 0) console.log('No serial ports found!');
  else ports.forEach(port => console.log(`  ${port.path}`));
  console.log('==============================\n');
}).catch(err => console.error('Error listing ports:', err.message));

loadAudioConfig();

const server = app.listen(PORT, () => {
  console.log(`\n✓ Server running at http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  wsClients.add(ws);

  // Send initial status
  ws.send(JSON.stringify({ type: 'status', connected: isSerialConnected }));
  ws.send(JSON.stringify({
    type: 'audioState',
    isPlaying: audioState.isPlaying,
    currentTime: getCurrentAudioTime(),
    fileName: audioState.fileName,
    duration: audioState.duration,
    playbackSpeed: audioState.playbackSpeed,
    hasAudio: !!audioFilePath && fs.existsSync(audioFilePath)
  }));
  
  // Send shared choreography
  ws.send(JSON.stringify({
    type: 'choreographySync',
    choreography: choreoEngine.choreography,
    reverseFlags: choreoEngine.reverseFlags,
    motorMapping: choreoEngine.motorMapping
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Filter spam
      if (data.type !== 'audioSync' && !(data.type === 'audio' && data.action === 'setSpeed')) {
        // console.log('WebSocket received:', data);
      }

      // -- Commands --
      
      if (data.type === 'playChoreography') {
          console.log('[Server] Play Choreography');
          choreoEngine.play(data.startTime || 0, data.speed || 1.0);
      }
      
      if (data.type === 'stopChoreography') {
          console.log('[Server] Stop Choreography');
          choreoEngine.stop();
      }

      if (data.type === 'choreographyUpdate') {
          // Update engine
          choreoEngine.updateConfig(data);
          // Persist
          saveSharedChoreography();
      }
      
      if (data.type === 'getChoreography') {
          ws.send(JSON.stringify({
            type: 'choreographySync',
            choreography: choreoEngine.choreography,
            reverseFlags: choreoEngine.reverseFlags,
            motorMapping: choreoEngine.motorMapping
          }));
      }

      if (data.type === 'audio') {
        // Legacy/Direct Audio Control
        switch (data.action) {
          case 'play':
            // If just 'audio' play is requested, do we run choreography?
            // For now, let's assume 'audio play' triggers choreography play if in that context
            // But to avoid confusion, let's keep it direct for now.
            // If the user uses the audio controls directly?
            playAudio(data.time || 0, data.speed || 1.0);
            break;
          case 'pause':
            pauseAudio();
            break;
          case 'seek':
            seekAudio(data.time || 0);
            break;
          case 'setSpeed':
            audioState.playbackSpeed = data.speed || 1.0;
            if (audioState.isPlaying) playAudio(getCurrentAudioTime(), audioState.playbackSpeed);
            break;
          case 'setVolume':
            audioState.volume = Math.max(0, Math.min(150, data.volume || 100));
            if (audioState.isPlaying) setMpvVolume(audioState.volume);
            broadcastAudioState();
            break;
        }
      }

      if (data.type === 'command') {
        if (serialPort && serialPort.isOpen) {
          serialPort.write(data.command + '\n', (err) => {
            if (err) console.error('Serial write error:', err);
          });
        }
      }

    } catch (error) {
      console.error('Error processing WebSocket message:', error.message);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsClients.delete(ws);
  });
});

// Heartbeat
setInterval(() => {
  if (isSerialConnected && serialPort && serialPort.isOpen) {
    serialPort.write('P\n', (err) => {});
  }
}, 1000);

// Audio Broadcast
setInterval(() => {
  if (audioState.isPlaying) broadcastAudioState();
}, 500);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  stopAudioProcess();
  if (serialPort && serialPort.isOpen) serialPort.close();
  process.exit(0);
});