import { UI_CONFIG, AXIS_NAMES, VBOX_CONFIG } from './config.js';
import { state } from './state.js';

let ws = null;

// Helper for conditional debug logging
const debugLog = (...args) => { if (state.debugMode) console.log(...args); };

// Callbacks to update UI
let onLog = (msg) => console.log(msg);
let onStatus = (connected, msg, motorsEnabled) => { };
let onPositionUpdate = () => { };
let onAudioStateUpdate = (audioState) => { };
let onChoreographySync = (data) => { };
let onPlayStateUpdate = (data) => { };

export function setupComms(callbacks) {
  if (callbacks.onLog) onLog = callbacks.onLog;
  if (callbacks.onStatus) onStatus = callbacks.onStatus;
  if (callbacks.onPositionUpdate) onPositionUpdate = callbacks.onPositionUpdate;
  if (callbacks.onAudioStateUpdate) onAudioStateUpdate = callbacks.onAudioStateUpdate;
  if (callbacks.onChoreographySync) onChoreographySync = callbacks.onChoreographySync;
  if (callbacks.onPlayStateUpdate) onPlayStateUpdate = callbacks.onPlayStateUpdate;
}

// Audio control commands (play on server/Pi)
export function sendAudioCommand(action, options = {}) {
  debugLog('[Comms] sendAudioCommand:', action, options);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'audio',
      action: action,
      ...options
    }));
  } else {
    debugLog('[Comms] WebSocket not open, cannot send audio command');
  }
}

export function playServerAudio(time = 0, speed = 1.0) {
  console.log('[Comms] >>> playServerAudio sending play command:', { time, speed });
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

    // Request shared choreography from server
    requestChoreography();
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
          onStatus(true, 'Connected to Arduino', data.motorsEnabled);
          onLog('Arduino connected');
          setTimeout(() => sendCommand('I'), 500);
        } else {
          onStatus(false, 'Arduino Disconnected');
          onLog('Arduino disconnected');
        }
      } else if (data.type === 'audioState') {
        // Update state with server audio info
        console.log('[Comms] audioState received:', {
          hasAudio: data.hasAudio,
          fileName: data.fileName,
          isPlaying: data.isPlaying,
          currentTime: data.currentTime,
          volume: data.volume
        });
        state.serverAudioLoaded = data.hasAudio || !!data.fileName;
        state.serverAudioPlaying = data.isPlaying;
        state.serverAudioTime = data.currentTime;
        state.serverAudioFileName = data.fileName;
        console.log('[Comms] state.serverAudioLoaded is now:', state.serverAudioLoaded);

        // Update volume slider if present
        if (data.volume !== undefined) {
          const volumeSlider = document.getElementById('volumeSlider');
          const volumeDisplay = document.getElementById('volumeDisplay');
          if (volumeSlider) volumeSlider.value = data.volume;
          if (volumeDisplay) volumeDisplay.textContent = data.volume + '%';
        }

        onAudioStateUpdate(data);
      } else if (data.type === 'choreographySync') {
        // Received choreography update from another client
        debugLog('[Comms] Choreography sync received:', data.fileName, data.choreography?.length, 'keyframes');
        onChoreographySync(data);
      } else if (data.type === 'playState') {
        onPlayStateUpdate(data);
      } else if (data.type === 'restState') {
        state.isResting = data.isResting;
        if (data.isResting) {
            state.restStartTime = data.startTime;
            state.restTotalDuration = (data.duration || state.restDuration) * 60 * 1000;
        }
      }
    } catch (error) {
      onLog('Error parsing message');
    }
  };
}

/* 
// Handle visibility changes to prevent background interference
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        if (ws) {
            console.log('[Comms] App backgrounded, closing WebSocket');
            ws.onclose = null; // Prevent automatic reconnection loop
            ws.close();
            ws = null;
            onStatus(false, 'Backgrounded');
        }
    } else if (document.visibilityState === 'visible') {
        console.log('[Comms] App foregrounded, reconnecting...');
        connectWebSocket();
    }
});
*/

export function sendCommand(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'command',
      command: command
    }));
    onLog(`> ${command}`);
  }
}

// Send choreography update to server for syncing with other clients
export function sendChoreographyUpdate() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'choreographyUpdate',
      choreography: state.choreography,
      fileName: state.currentFileName,
      reverseFlags: state.reverseFlags,
      motorMapping: state.motorMapping,
      loopEnabled: state.loopEnabled,
      restEnabled: state.restEnabled,
      restDuration: state.restDuration,
      frameDimensions: {
          width: VBOX_CONFIG.frameWidth,
          length: VBOX_CONFIG.frameLength,
          height: VBOX_CONFIG.maxHeight
      },
      settings: {
        speed: state.uiMaxSpeed,
        accel: state.uiAcceleration
      }
    }));
    debugLog('[Comms] Sent choreography update to server');
  }
}

export function sendPlayChoreography(time, speed) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'playChoreography',
      startTime: time,
      speed: speed
    }));
  }
}

export function sendPauseChoreography() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'pauseChoreography'
    }));
  }
}

export function sendStopChoreography() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'stopChoreography'
    }));
  }
}

// Request current choreography from server
export function requestChoreography() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'getChoreography' }));
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
    if (toggle && !toggle.checked && !state.isTogglingMotors) {
      toggle._updatingFromArduino = true;
      toggle.checked = true;
      toggle._updatingFromArduino = false;
    }
  } else if (message.includes("Motors: DISABLED")) {
    const toggle = document.getElementById('motorToggle');
    if (toggle && toggle.checked && !state.isTogglingMotors) {
      toggle._updatingFromArduino = true;
      toggle.checked = false;
      toggle._updatingFromArduino = false;
    }
  }

  if (message.includes("Inverted:")) {
    // Expected format: Inverted: X=1 Y=0 Z=1 A=0
    const parts = message.split('Inverted:')[1].trim().split(' ');
    const physInverted = {};
    parts.forEach(part => {
        const [axis, val] = part.split('=');
        if (axis && val) {
            physInverted[axis] = (val === '1');
        }
    });

    // Update logical state
    const uiIds = ['reverseX', 'reverseY', 'reverseZ', 'reverseA'];
    
    for (let logicalIndex = 0; logicalIndex < 4; logicalIndex++) {
        const physicalIndex = state.motorMapping[logicalIndex];
        const physicalAxisChar = AXIS_NAMES[physicalIndex];
        
        if (physInverted[physicalAxisChar] !== undefined) {
            const isInv = physInverted[physicalAxisChar];
            state.reverseFlags[logicalIndex] = isInv;
            
            // Update UI
            const checkbox = document.getElementById(uiIds[logicalIndex]);
            if (checkbox) {
                checkbox.checked = isInv;
            }
        }
    }
    onLog("Synced inversion status from Arduino");
  }

  if (updated) onPositionUpdate();
}