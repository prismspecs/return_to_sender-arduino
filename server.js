import express from 'express';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Configure serial port - adjust to your device
let currentSerialPort = null;
const BAUD_RATE = 115200;

let serialPort = null;
let parser = null;
let wsClients = new Set();
let isSerialConnected = false;

// Initialize serial connection
function initSerial(portPath) {
  if (!portPath) return;

  // Cleanup previous instance
  if (serialPort) {
    // If we are already connected to this port, do nothing
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

    // Forward Arduino responses to all connected WebSocket clients
    parser.on('data', (data) => {
      const message = data.trim();
      // console.log('Arduino:', message);
      
      wsClients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
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

// API endpoint to list ports
app.get('/api/ports', async (req, res) => {
    try {
        const ports = await SerialPort.list();
        res.json(ports);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API endpoint to connect to a port
app.post('/api/connect', (req, res) => {
    const { port } = req.body;
    if (!port) {
        return res.status(400).json({ error: 'Port is required' });
    }
    initSerial(port);
    res.json({ success: true, message: `Connecting to ${port}...` });
});

// API endpoint to send commands
app.post('/api/command', (req, res) => {
  const { command } = req.body;
  
  if (!serialPort || !serialPort.isOpen) {
    return res.status(503).json({ error: 'Serial port not connected' });
  }

  serialPort.write(command + '\n', (err) => {
    if (err) {
      console.error('Error writing to serial:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

// List available ports on startup
SerialPort.list().then(ports => {
  console.log('\n=== Available Serial Ports ===');
  if (ports.length === 0) {
    console.log('No serial ports found!');
  } else {
    ports.forEach(port => {
      console.log(`  ${port.path}`);
    });
  }
  console.log('==============================\n');
}).catch(err => {
  console.error('Error listing ports:', err.message);
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`\n✓ Server running at http://localhost:${PORT}`);
  console.log('✓ Open this URL in your browser to control the motors\n');
});

// Setup WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  wsClients.add(ws);
  
  // Send initial connection status
  ws.send(JSON.stringify({
    type: 'status',
    connected: isSerialConnected
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('WebSocket received:', data);
      
      if (data.type === 'command') {
        if (!serialPort) {
          console.error('Serial port is null!');
          return;
        }
        if (!serialPort.isOpen) {
          console.error('Serial port is not open!');
          return;
        }
        
        console.log(`Writing to serial: "${data.command}"`);
        serialPort.write(data.command + '\n', (err) => {
          if (err) {
            console.error('Serial write error:', err);
          } else {
            console.log('Serial write successful');
          }
        });
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

// Initialize serial connection

// initSerial(); 



// Heartbeat to keep Arduino alive
setInterval(() => {
  if (isSerialConnected && serialPort && serialPort.isOpen) {
    serialPort.write('P\n', (err) => {
      if (err) {
        // console.error('Heartbeat error:', err.message);
      }
    });
  }
}, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  process.exit(0);
});

