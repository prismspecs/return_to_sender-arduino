import { UI_CONFIG, AXIS_NAMES } from './config.js';
import { state } from './state.js';

let ws = null;

// Callbacks to update UI
let onLog = (msg) => console.log(msg);
let onStatus = (connected, msg) => { };
let onPositionUpdate = () => { };
let onAudioStateUpdate = (audioState) => { };

export function setupComms(callbacks) {
  if (callbacks.onLog) onLog = callbacks.onLog;
  if (callbacks.onStatus) onStatus = callbacks.onStatus;
  if (callbacks.onPositionUpdate) onPositionUpdate = callbacks.onPositionUpdate;
  if (callbacks.onAudioStateUpdate) onAudioStateUpdate = callbacks.onAudioStateUpdate;
}

// Audio control commands (play on server/Pi)
export function sendAudioCommand(action, options = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'audio',
      action: action,
      ...options
    }));
  }
}

export function playServerAudio(time = 0, speed = 1.0) {
  sendAudioCommand('play', { time, speed });
}

export function pauseServerAudio() {
  sendAudioCommand('pause');
}

export function seekServerAudio(time) {
  sendAudioCommand('seek', { time });
}

export function setServerAudioSpeed(speed) {
  sendAudioCommand('setSpeed', { speed });
}

export function connectWebSocket() {
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  onStatus(false, 'Connecting...');
  ws = new WebSocket(wsUrl);

  const connectionTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      onLog('Connection timed out. Retrying...');
      ws.close();
    }
  }, UI_CONFIG.checkConnectionInterval);

  ws.onopen = () => {
    clearTimeout(connectionTimeout);
    // onStatus(true, 'Connected to Arduino'); // Wait for actual serial status
    onLog('Connected to server');
    // Status check 'I' will be sent when we receive connected: true from server
  };

  ws.onclose = () => {
    clearTimeout(connectionTimeout);
    onStatus(false);
    onLog('Disconnected from server. Reconnecting...');
    setTimeout(connectWebSocket, UI_CONFIG.reconnectInterval);
  };

  ws.onerror = (error) => {
    onLog('WebSocket error');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'arduino') {
        // onLog(data.message); // Optional: log all arduino messages? Too spammy?
        parseArduinoMessage(data.message);
      } else if (data.type === 'status') {
        if (data.connected) {
          onStatus(true, 'Connected to Arduino');
          onLog('Arduino connected');
          setTimeout(() => sendCommand('I'), 500);
        } else {
          onStatus(false, 'Arduino Disconnected');
          onLog('Arduino disconnected');
        }
      } else if (data.type === 'audioState') {
        // Update state with server audio info
        state.serverAudioLoaded = data.hasAudio || !!data.fileName;
        state.serverAudioPlaying = data.isPlaying;
        state.serverAudioTime = data.currentTime;
        state.serverAudioFileName = data.fileName;
        onAudioStateUpdate(data);
      }
    } catch (error) {
      onLog('Error parsing message');
    }
  };
}

export function sendCommand(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'command',
      command: command
    }));
    onLog(`> ${command}`);
  }
}

function parseArduinoMessage(message) {
  const posMatches = [...message.matchAll(/([XYZA]):\s*pos=(-?\d+)/g)];
  let updated = false;

  if (posMatches.length > 0) {
    posMatches.forEach(match => {
      const physicalAxisChar = match[1];
      const physicalAxisIndex = AXIS_NAMES.indexOf(physicalAxisChar);

      if (physicalAxisIndex !== -1) {
        // We need reverse mapping index. 
        // state.motorMapping is [0, 1, 3, 2] means Logical 0 maps to Phys 0.
        // So Phys 0 maps to Logical 0.
        // We need to find `i` such that state.motorMapping[i] === physicalAxisIndex
        const logicalAxisIndex = state.motorMapping.indexOf(physicalAxisIndex);

        if (logicalAxisIndex !== -1) {
          const newPos = parseInt(match[2]);
          state.currentPositions[logicalAxisIndex] = newPos;

          // Sync visual if error is large
          if (Math.abs(state.visualPositions[logicalAxisIndex] - newPos) > 5000) {
            state.visualPositions[logicalAxisIndex] = newPos;
          }
          updated = true;
        }
      }
    });
  }

  if (message.includes("Motors: ENABLED")) {
    const toggle = document.getElementById('motorToggle');
    if (toggle) toggle.checked = true;
    // We should update state but areMotorsEnabled is local to app.js usually.
    // Let's assume UI update handles it.
  } else if (message.includes("Motors: DISABLED")) {
    const toggle = document.getElementById('motorToggle');
    if (toggle) toggle.checked = false;
  }

  if (message.includes("Inverted:")) {
    onLog("Synced inversion status from Arduino");
  }

  if (updated) onPositionUpdate();
}
