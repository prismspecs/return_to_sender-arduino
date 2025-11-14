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
const SERIAL_PORT = '/dev/ttyACM0';
const BAUD_RATE = 115200;

let serialPort = null;
let parser = null;
let wsClients = new Set();
let isSerialConnected = false;

// Initialize serial connection
function initSerial() {
  try {
    serialPort = new SerialPort({
      path: SERIAL_PORT,
      baudRate: BAUD_RATE,
      autoOpen: false
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    serialPort.open((err) => {
      if (err) {
        console.error('\n❌ Error opening serial port:', err.message);
        console.error('\nCommon fixes:');
        console.error('1. Check if Arduino is connected: ls -l /dev/ttyACM* /dev/ttyUSB*');
        console.error('2. Close Arduino IDE serial monitor');
        console.error('3. Check permissions: sudo usermod -a -G dialout $USER (then logout/login)');
        console.error('4. Run: node check-serial.js to see available ports\n');
        isSerialConnected = false;
        return;
      }
      console.log(`✓ Connected to Arduino on ${SERIAL_PORT}`);
      isSerialConnected = true;
      
      // Notify all connected clients
      wsClients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'status',
            connected: true
          }));
        }
      });
    });

    // Forward Arduino responses to all connected WebSocket clients
    parser.on('data', (data) => {
      const message = data.trim();
      console.log('Arduino:', message);
      
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
    });

    serialPort.on('close', () => {
      console.log('Serial port closed');
      isSerialConnected = false;
      
      // Notify all connected clients
      wsClients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'status',
            connected: false
          }));
        }
      });
    });

  } catch (error) {
    console.error('Failed to initialize serial:', error.message);
  }
}

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

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
      console.log(`  ${port.path}${port.path === SERIAL_PORT ? ' (configured)' : ''}`);
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
initSerial();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  process.exit(0);
});

