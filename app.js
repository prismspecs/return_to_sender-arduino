let ws = null;
let currentPositions = [0, 0, 0, 0];
let reverseFlags = [false, false, false, false];
const axisNames = ['X', 'Y', 'Z', 'A'];

// Choreography state
let choreography = [];
let isPlaying = false;
let playbackSpeed = 1.0;
let playbackStartTime = 0;
let choreographyStartTime = 0;
let playbackInterval = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateStatus(true);
    logConsole('Connected to server');
  };

  ws.onclose = () => {
    updateStatus(false);
    logConsole('Disconnected from server. Reconnecting...');
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (error) => {
    logConsole('WebSocket error');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'arduino') {
        logConsole(data.message);
        parseArduinoMessage(data.message);
      } else if (data.type === 'status') {
        updateStatus(data.connected);
        if (data.connected) {
          logConsole('Arduino connected');
        } else {
          logConsole('Arduino disconnected');
        }
      }
    } catch (error) {
      logConsole('Error parsing message');
    }
  };
}

function updateStatus(connected) {
  const indicator = document.getElementById('statusIndicator');
  const text = document.getElementById('statusText');
  
  if (connected) {
    indicator.classList.add('connected');
    text.textContent = 'Connected';
  } else {
    indicator.classList.remove('connected');
    text.textContent = 'Disconnected';
  }
}

function parseArduinoMessage(message) {
  const posMatch = message.match(/([XYZA]):\s*pos=(-?\d+)/);
  if (posMatch) {
    const axis = axisNames.indexOf(posMatch[1]);
    if (axis !== -1) {
      currentPositions[axis] = parseInt(posMatch[2]);
      updatePositionDisplay(axis);
    }
  }
}

function updatePositionDisplay(axis) {
  const displayId = `pos${axisNames[axis]}`;
  const sliderId = `slider${axisNames[axis]}`;
  
  let displayValue = currentPositions[axis];
  
  // Display the reversed value on the slider if reverse is enabled
  if (reverseFlags[axis]) {
    displayValue = -currentPositions[axis];
  }
  
  document.getElementById(displayId).textContent = currentPositions[axis];
  document.getElementById(sliderId).value = displayValue;
}

function updateSliderDisplay(axisName, axisIndex, value) {
  // Live update while dragging - just visual feedback
}

function moveToSlider(axisName, axisIndex, value) {
  let targetPosition = parseInt(value);
  
  // Apply reverse if enabled
  if (reverseFlags[axisIndex]) {
    targetPosition = -targetPosition;
  }
  
  const positions = [...currentPositions];
  positions[axisIndex] = targetPosition;
  
  sendCommand(`M ${positions.join(' ')}`);
  currentPositions[axisIndex] = targetPosition;
  updatePositionDisplay(axisIndex);
}

function sendCommand(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'command',
      command: command
    }));
    logConsole(`> ${command}`);
  }
}

function logConsole(message) {
  const consoleDiv = document.getElementById('console');
  const line = document.createElement('div');
  line.className = 'console-line';
  line.textContent = message;
  consoleDiv.appendChild(line);
  consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

function clearConsole() {
  document.getElementById('console').innerHTML = '';
}

function moveAbsolute(axisName, axisIndex) {
  const inputId = `${axisName.toLowerCase()}Absolute`;
  const value = parseInt(document.getElementById(inputId).value);
  
  const positions = [...currentPositions];
  positions[axisIndex] = value;
  
  sendCommand(`M ${positions.join(' ')}`);
  currentPositions[axisIndex] = value;
  updatePositionDisplay(axisIndex);
}

function moveRelative(axisName, axisIndex) {
  const inputId = `${axisName.toLowerCase()}Relative`;
  const value = parseInt(document.getElementById(inputId).value);
  
  const relative = [0, 0, 0, 0];
  relative[axisIndex] = value;
  
  sendCommand(`R ${relative.join(' ')}`);
  currentPositions[axisIndex] += value;
  updatePositionDisplay(axisIndex);
}

function quickMove(axisName, axisIndex, steps) {
  let moveSteps = steps;
  
  if (reverseFlags[axisIndex]) {
    moveSteps = -steps;
  }
  
  const relative = [0, 0, 0, 0];
  relative[axisIndex] = moveSteps;
  
  sendCommand(`R ${relative.join(' ')}`);
  
  currentPositions[axisIndex] += moveSteps;
  updatePositionDisplay(axisIndex);
}

function moveAllMotors(steps) {
  console.log(`moveAllMotors called with steps: ${steps}`);
  
  const relative = [0, 0, 0, 0];
  
  for (let i = 0; i < 4; i++) {
    let moveSteps = steps;
    if (reverseFlags[i]) {
      moveSteps = -steps;
    }
    relative[i] = moveSteps;
    currentPositions[i] += moveSteps;
  }
  
  console.log(`Sending command: R ${relative.join(' ')}`);
  sendCommand(`R ${relative.join(' ')}`);
  
  axisNames.forEach((_, index) => updatePositionDisplay(index));
  logConsole(`All motors: moved ${steps} steps`);
}

function setSpeed() {
  const speed = document.getElementById('speed').value;
  sendCommand(`S${speed}`);
}

function setAcceleration() {
  const accel = document.getElementById('accel').value;
  sendCommand(`A${accel}`);
}

function homeAll() {
  sendCommand('H');
  currentPositions = [0, 0, 0, 0];
  axisNames.forEach((_, index) => updatePositionDisplay(index));
}

function toggleReverse(axisIndex, checked) {
  reverseFlags[axisIndex] = checked;
  logConsole(`${axisNames[axisIndex]}-axis reverse: ${checked ? 'ON' : 'OFF'}`);
}

// Choreography Functions

function recordKeyframe() {
  const time = choreography.length === 0 ? 0 : 
    (Date.now() - choreographyStartTime) / 1000;
  
  if (choreography.length === 0) {
    choreographyStartTime = Date.now();
  }
  
  const keyframe = {
    time: time,
    positions: [...currentPositions]
  };
  
  choreography.push(keyframe);
  choreography.sort((a, b) => a.time - b.time);
  
  logConsole(`Keyframe recorded at ${time.toFixed(2)}s: [${currentPositions.join(', ')}]`);
  updateKeyframesList();
  updateTimeline();
}

function updateKeyframesList() {
  const list = document.getElementById('keyframesList');
  list.innerHTML = '';
  
  choreography.forEach((kf, index) => {
    const item = document.createElement('div');
    item.className = 'keyframe-item';
    item.innerHTML = `
      <span>${kf.time.toFixed(2)}s: [${kf.positions.join(', ')}]</span>
      <button onclick="deleteKeyframe(${index})">Delete</button>
    `;
    list.appendChild(item);
  });
}

function updateTimeline() {
  const timeline = document.querySelector('.timeline-track');
  const markers = timeline.querySelectorAll('.keyframe-marker:not(.playhead)');
  markers.forEach(m => m.remove());
  
  if (choreography.length === 0) return;
  
  const maxTime = Math.max(...choreography.map(kf => kf.time));
  const timelineWidth = timeline.offsetWidth;
  
  choreography.forEach((kf, index) => {
    const marker = document.createElement('div');
    marker.className = 'keyframe-marker';
    marker.style.left = `${(kf.time / maxTime) * timelineWidth}px`;
    marker.title = `${kf.time.toFixed(2)}s`;
    marker.onclick = () => goToKeyframe(index);
    timeline.appendChild(marker);
  });
}

function goToKeyframe(index) {
  const kf = choreography[index];
  currentPositions = [...kf.positions];
  sendCommand(`M ${currentPositions.join(' ')}`);
  axisNames.forEach((_, i) => updatePositionDisplay(i));
  logConsole(`Jumped to keyframe at ${kf.time.toFixed(2)}s`);
}

function deleteKeyframe(index) {
  choreography.splice(index, 1);
  updateKeyframesList();
  updateTimeline();
  logConsole(`Keyframe ${index} deleted`);
}

function clearChoreography() {
  choreography = [];
  updateKeyframesList();
  updateTimeline();
  logConsole('Choreography cleared');
}

function playChoreography() {
  if (choreography.length === 0) {
    logConsole('No choreography to play');
    return;
  }
  
  if (isPlaying) {
    stopChoreography();
    return;
  }
  
  isPlaying = true;
  playbackStartTime = Date.now();
  document.getElementById('btnPlay').textContent = 'Pause';
  document.getElementById('btnPlay').classList.add('playing');
  
  logConsole('Playing choreography...');
  
  let keyframeIndex = 0;
  
  playbackInterval = setInterval(() => {
    const elapsed = ((Date.now() - playbackStartTime) / 1000) * playbackSpeed;
    
    updatePlayhead(elapsed);
    
    while (keyframeIndex < choreography.length && 
           choreography[keyframeIndex].time <= elapsed) {
      
      const kf = choreography[keyframeIndex];
      currentPositions = [...kf.positions];
      sendCommand(`M ${currentPositions.join(' ')}`);
      axisNames.forEach((_, i) => updatePositionDisplay(i));
      
      keyframeIndex++;
    }
    
    if (keyframeIndex >= choreography.length) {
      stopChoreography();
      logConsole('Choreography complete');
    }
  }, 50);
}

function stopChoreography() {
  isPlaying = false;
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  document.getElementById('btnPlay').textContent = 'Play';
  document.getElementById('btnPlay').classList.remove('playing');
  removePlayhead();
}

function updatePlayhead(time) {
  const timeline = document.querySelector('.timeline-track');
  let playhead = timeline.querySelector('.playhead');
  
  if (!playhead) {
    playhead = document.createElement('div');
    playhead.className = 'playhead';
    timeline.appendChild(playhead);
  }
  
  if (choreography.length === 0) return;
  
  const maxTime = Math.max(...choreography.map(kf => kf.time));
  const timelineWidth = timeline.offsetWidth;
  const position = (time / maxTime) * timelineWidth;
  
  playhead.style.left = `${Math.min(position, timelineWidth)}px`;
}

function removePlayhead() {
  const playhead = document.querySelector('.playhead');
  if (playhead) playhead.remove();
}

function updatePlaybackSpeed(value) {
  playbackSpeed = parseFloat(value);
  document.getElementById('speedDisplay').textContent = `${playbackSpeed.toFixed(1)}x`;
}

function saveChoreography() {
  if (choreography.length === 0) {
    logConsole('No choreography to save');
    return;
  }
  
  const data = {
    version: '1.0',
    choreography: choreography,
    reverseFlags: reverseFlags
  };
  
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `choreography_${Date.now()}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
  logConsole('Choreography saved');
}

function loadChoreography() {
  document.getElementById('fileInput').click();
}

function handleFileLoad(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      choreography = data.choreography || [];
      
      if (data.reverseFlags) {
        reverseFlags = data.reverseFlags;
        axisNames.forEach((name, i) => {
          document.getElementById(`reverse${name}`).checked = reverseFlags[i];
        });
      }
      
      updateKeyframesList();
      updateTimeline();
      logConsole(`Choreography loaded: ${choreography.length} keyframes`);
    } catch (error) {
      logConsole('Error loading choreography file');
    }
  };
  reader.readAsText(file);
  
  event.target.value = '';
}

// Make functions globally accessible
window.quickMove = quickMove;
window.moveAllMotors = moveAllMotors;
window.moveToSlider = moveToSlider;
window.updateSliderDisplay = updateSliderDisplay;
window.toggleReverse = toggleReverse;
window.homeAll = homeAll;
window.setSpeed = setSpeed;
window.setAcceleration = setAcceleration;
window.clearConsole = clearConsole;
window.recordKeyframe = recordKeyframe;
window.playChoreography = playChoreography;
window.stopChoreography = stopChoreography;
window.clearChoreography = clearChoreography;
window.saveChoreography = saveChoreography;
window.loadChoreography = loadChoreography;
window.deleteKeyframe = deleteKeyframe;
window.goToKeyframe = goToKeyframe;
window.updatePlaybackSpeed = updatePlaybackSpeed;
window.handleFileLoad = handleFileLoad;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  
  setTimeout(() => {
    sendCommand('I');
  }, 2000);
});
