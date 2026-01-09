import { 
    VBOX_CONFIG, 
    PHYSICAL_Z_OFFSET, 
    AXIS_NAMES, 
    DEFAULT_MOTOR_MAPPING, 
    UI_CONFIG 
} from './config.js';

import { 
    getMotorPositions, 
    calculateCorners, 
    calculateDistance,
    calculateTargetSteps 
} from './kinematics.js';

let ws = null;
let currentPositions = [0, 0, 0, 0];
// Visual positions for smooth animation
let visualPositions = [0, 0, 0, 0]; 
let motorVelocities = [0, 0, 0, 0];
let lastFrameTime = 0;
let uiMaxSpeed = 24000;
let uiAcceleration = 24000;

let reverseFlags = [false, false, false, false];
let motorMapping = [...DEFAULT_MOTOR_MAPPING]; 
const axisNames = AXIS_NAMES;

// --- Animation Loop ---

function animateDisplay(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = (timestamp - lastFrameTime) / 1000; // seconds
  lastFrameTime = timestamp;

  // Check toggle
  const smoothAnimation = document.getElementById('smoothAnimation');
  const isSmooth = smoothAnimation ? smoothAnimation.checked : true;

  if (!isSmooth) {
    let changed = false;
    for (let i = 0; i < 4; i++) {
        if (visualPositions[i] !== currentPositions[i]) {
            visualPositions[i] = currentPositions[i];
            motorVelocities[i] = 0;
            changed = true;
        }
    }
    if (changed) {
        for (let i = 0; i < 4; i++) updatePositionDisplay(i);
    }
    requestAnimationFrame(animateDisplay);
    return;
  }

  // Use globals for speed/accel
  const maxSpeed = uiMaxSpeed; 
  const acceleration = uiAcceleration;

  let changed = false;

  for (let i = 0; i < 4; i++) {
    const target = currentPositions[i];
    const current = visualPositions[i];
    const diff = target - current;
    
    // Threshold to stop
    if (Math.abs(diff) < 0.1 && Math.abs(motorVelocities[i]) < 1) {
      if (visualPositions[i] !== target) {
        visualPositions[i] = target;
        motorVelocities[i] = 0;
        changed = true;
      }
      continue;
    }

    // Velocity Ramping Logic
    // Desired velocity based on distance
    // v = sqrt(2 * a * s)
    // We want to stop at target.
    // Max safe velocity to be able to stop in time:
    const safeSpeed = Math.sqrt(2 * acceleration * Math.abs(diff));
    let targetVel = Math.sign(diff) * Math.min(maxSpeed, safeSpeed);

    // Apply acceleration to current velocity
    const velDiff = targetVel - motorVelocities[i];
    const maxVelChange = acceleration * dt;
    
    if (Math.abs(velDiff) < maxVelChange) {
      motorVelocities[i] = targetVel;
    } else {
      motorVelocities[i] += Math.sign(velDiff) * maxVelChange;
    }

    // Apply velocity to position
    const move = motorVelocities[i] * dt;
    visualPositions[i] += move;
    changed = true;
  }

  if (changed) {
    for (let i = 0; i < 4; i++) {
       updatePositionDisplay(i);
    }
  }

  requestAnimationFrame(animateDisplay);
}

// Start animation loop
requestAnimationFrame(animateDisplay);

// --- Mapping Functions ---

function toggleMappingPanel() {
  const panel = document.getElementById('mappingPanel');
  panel.style.display = panel.style.display === 'none' ? 'grid' : 'none';
}

function updateMapping() {
  for (let i = 0; i < 4; i++) {
    const select = document.getElementById(`mapM${i}`);
    motorMapping[i] = parseInt(select.value);
  }
  localStorage.setItem('motorMapping', JSON.stringify(motorMapping));
  logConsole(`Mapping updated: ${motorMapping.join(', ')}`);
  
  // Refresh altitude meters based on new mapping
  for (let i = 0; i < 4; i++) {
    updatePositionDisplay(i);
  }
}

function loadMapping() {
  const saved = localStorage.getItem('motorMapping');
  if (saved) {
    try {
      motorMapping = JSON.parse(saved);
      logConsole(`Mapping loaded: ${motorMapping.join(', ')}`);
    } catch (e) {
      console.error("Error loading mapping", e);
    }
  }
  
  // Sync UI with current mapping (loaded or default)
  for (let i = 0; i < 4; i++) {
    const select = document.getElementById(`mapM${i}`);
    if (select) select.value = motorMapping[i];
  }
}

function applyMapping(logicalSteps) {
  const physicalSteps = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const driverIndex = motorMapping[i];
    physicalSteps[driverIndex] = logicalSteps[i];
  }
  return physicalSteps;
}

function reverseMappingIndex(physicalDriverIndex) {
  return motorMapping.indexOf(physicalDriverIndex);
}

// --- Choreography State ---

let choreography = [];
let isPlaying = false;
let playbackSpeed = 1.0;
let playbackStartTime = 0;
let choreographyStartTime = 0;
let playbackInterval = null;

// --- WebSocket & Connection ---

function connectWebSocket() {
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  updateStatus(false, 'Connecting...');
  ws = new WebSocket(wsUrl);

  const connectionTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      logConsole('Connection timed out. Retrying...');
      ws.close();
    }
  }, UI_CONFIG.checkConnectionInterval);

  ws.onopen = () => {
    clearTimeout(connectionTimeout);
    updateStatus(true);
    logConsole('Connected to server');
    setTimeout(() => {
        sendCommand('I');
        syncHardwareConfig();
    }, UI_CONFIG.statusCheckDelay);
  };

  ws.onclose = () => {
    clearTimeout(connectionTimeout);
    updateStatus(false);
    logConsole('Disconnected from server. Reconnecting...');
    setTimeout(connectWebSocket, UI_CONFIG.reconnectInterval);
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
        if (data.connected) {
           updateStatus(true, 'Connected');
           logConsole('Arduino connected');
           setTimeout(() => sendCommand('I'), 500);
        } else {
           updateStatus(false, 'Arduino Disconnected');
           logConsole('Arduino disconnected');
        }
      }
    } catch (error) {
      logConsole('Error parsing message');
    }
  };
}

function updateStatus(connected, message = null) {
  const indicator = document.getElementById('statusIndicator');
  const text = document.getElementById('statusText');
  
  if (connected) {
    indicator.classList.add('connected');
    indicator.classList.remove('connecting');
    text.textContent = message || 'Connected';
  } else {
    indicator.classList.remove('connected');
    if (message === 'Connecting...') {
       indicator.classList.add('connecting');
       text.textContent = message;
    } else {
       indicator.classList.remove('connecting');
       text.textContent = message || 'Disconnected';
    }
  }
}

function parseArduinoMessage(message) {
  const posMatches = [...message.matchAll(/([XYZA]):\s*pos=(-?\d+)/g)];
  
  if (posMatches.length > 0) {
    posMatches.forEach(match => {
      const physicalAxisChar = match[1];
      const physicalAxisIndex = axisNames.indexOf(physicalAxisChar);
      
      if (physicalAxisIndex !== -1) {
        const logicalAxisIndex = reverseMappingIndex(physicalAxisIndex);
        if (logicalAxisIndex !== -1) {
          const newPos = parseInt(match[2]);
          currentPositions[logicalAxisIndex] = newPos;
          
          // Also sync visual if error is large (e.g. startup sync), 
          // or let animation catch up.
          // If we are significantly off, snap to it to avoid long animations on reconnect
          if (Math.abs(visualPositions[logicalAxisIndex] - newPos) > 5000) {
              visualPositions[logicalAxisIndex] = newPos;
          }
          
          updatePositionDisplay(logicalAxisIndex);
        }
      }
    });
  }

  if (message.includes("Motors: ENABLED")) {
    document.getElementById('motorToggle').checked = true;
    areMotorsEnabled = true;
  } else if (message.includes("Motors: DISABLED")) {
    document.getElementById('motorToggle').checked = false;
    areMotorsEnabled = false;
  }

  if (message.includes("Inverted:")) {
    const parts = message.split('Inverted: ')[1].trim().split(' ');
    parts.forEach(part => {
      const [axisName, state] = part.split('=');
      const physicalAxisIndex = axisNames.indexOf(axisName);
      if (physicalAxisIndex !== -1) {
         // UI update disabled to preserve local config as per original code
         // const isInverted = (state === '1');
      }
    });
    logConsole("Synced inversion status from Arduino");
  }
}

function updatePositionDisplay(motorIndex) {
  // motorIndex is the logical motor index (0-3 for M0-M3)
  const physicalAxisIndex = motorMapping[motorIndex];
  const displayId = `pos${axisNames[physicalAxisIndex]}`;
  
  // Use visualPositions for smooth display
  let displayValue = Math.round(visualPositions[motorIndex]);
  
  if (reverseFlags[physicalAxisIndex]) {
    displayValue = -displayValue;
  }
  
  const displayEl = document.getElementById(displayId);
  if(displayEl) displayEl.textContent = displayValue;
  
  // Update the altitude meter for this specific motor
  // Show height: 0mm = floor, 900mm = ceiling
  // Convert steps to mm.
  // Positive Steps = Pull In = Move UP.
  // Therefore height is proportional to steps.
  // 0 steps = Floor.
  
  const stringLengthMm = visualPositions[motorIndex] / VBOX_CONFIG.stepsPerMm;
  const heightMm = stringLengthMm; // Corrected: Steps directly map to height above floor
  
  updateAltitudeMeter(motorIndex, heightMm);
}

function updateAltitudeMeter(motorIndex, heightMm) {
  const meter = document.getElementById(`altM${motorIndex}`);
  if (meter) {
      let h = heightMm;
      // Clamp to 0-900 range for visual display
      if (h < 0) h = 0;
      if (h > 900) h = 900;
      const percent = (h / 900) * 100;
      meter.style.height = `${percent}%`;
  }
}

function updateSliderDisplay(axisName, axisIndex, value) {
  const displayId = `pos${axisName}`;
  const el = document.getElementById(displayId);
  if(el) el.textContent = value;
}

function moveToSlider(axisName, axisIndex, value) {
  let targetPosition = parseInt(value);
  
  if (reverseFlags[axisIndex]) {
    targetPosition = -targetPosition;
  }
  
  const positions = [...currentPositions];
  positions[axisIndex] = targetPosition;
  
  const physicalSteps = applyMapping(positions);
  sendCommand(`M ${physicalSteps.join(' ')}`);
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
  if(!consoleDiv) return;
  const line = document.createElement('div');
  line.className = 'console-line';
  line.textContent = message;
  consoleDiv.appendChild(line);
  consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

function clearConsole() {
  const el = document.getElementById('console');
  if(el) el.innerHTML = '';
}

function quickMove(axisName, axisIndex, distanceMm) {
  const steps = Math.round(distanceMm * VBOX_CONFIG.stepsPerMm);
  let moveSteps = steps;
  
  const relative = [0, 0, 0, 0];
  relative[axisIndex] = moveSteps;
  
  const physicalRelative = applyMapping(relative);
  sendCommand(`R ${physicalRelative.join(' ')}`);
  
  currentPositions[axisIndex] += moveSteps;
  updatePositionDisplay(axisIndex);
}

function moveAllMotors(distanceMm) {
  const steps = Math.round(distanceMm * VBOX_CONFIG.stepsPerMm);
  const relative = [0, 0, 0, 0];
  
  for (let i = 0; i < 4; i++) {
    relative[i] = steps;
    currentPositions[i] += steps;
  }
  
  const physicalRelative = applyMapping(relative);
  sendCommand(`R ${physicalRelative.join(' ')}`);
  
  axisNames.forEach((_, index) => updatePositionDisplay(index));
  logConsole(`All motors: moved ${distanceMm}mm (${steps} steps)`);
}

function moveAllToZero() {
  currentPositions = [0, 0, 0, 0];
  // visualPositions will catch up via animation
  const physicalSteps = applyMapping([0, 0, 0, 0]);
  sendCommand(`M ${physicalSteps.join(' ')}`);
  axisNames.forEach((_, index) => updatePositionDisplay(index));
  logConsole('All motors: moving to 0');
}

function setSpeed() {
  const speed = document.getElementById('speed').value;
  uiMaxSpeed = parseFloat(speed) || 24000;
  sendCommand(`S ${speed}`);
}

function setAcceleration() {
  const accel = document.getElementById('accel').value;
  uiAcceleration = parseFloat(accel) || 24000;
  sendCommand(`A ${accel}`);
}

let areMotorsEnabled = false;

function homeAll() {
  sendCommand('H');
  currentPositions = [0, 0, 0, 0];
  axisNames.forEach((_, index) => updatePositionDisplay(index));

  if (!areMotorsEnabled) {
    const toggle = document.getElementById('motorToggle');
    if(toggle) toggle.checked = true;
    toggleMotors(true);
    logConsole('Motors automatically engaged for homing.');
  }
}

function setFloor() {
  sendCommand('H');
  currentPositions = [0, 0, 0, 0];
  axisNames.forEach((_, index) => updatePositionDisplay(index));
  
  document.getElementById('boxZ').value = 0;
  document.getElementById('valBoxZ').textContent = '0';
  
  logConsole('Floor set (Current position set to 0).');
}

function toggleMotors(isChecked) {
  areMotorsEnabled = isChecked;
  if (areMotorsEnabled) {
    sendCommand('E 1');
    logConsole('Motors ENGAGED');
  } else {
    sendCommand('E 0');
    logConsole('Motors DISENGAGED (resting)');
  }
}

function toggleReverse(logicalAxisIndex, checked) {
  reverseFlags[logicalAxisIndex] = checked;
  saveReverseFlags();
  
  const physicalDriverIndex = motorMapping[logicalAxisIndex];
  sendCommand(`V ${physicalDriverIndex} ${checked ? 1 : 0}`);
  
  logConsole(`${axisNames[logicalAxisIndex]}-axis (Driver ${axisNames[physicalDriverIndex]}) reverse: ${checked ? 'ON' : 'OFF'}`);
}

function saveReverseFlags() {
  localStorage.setItem('reverseFlags', JSON.stringify(reverseFlags));
}

function loadReverseFlags() {
  const saved = localStorage.getItem('reverseFlags');
  if (saved) {
    try {
      const loadedFlags = JSON.parse(saved);
      if (Array.isArray(loadedFlags) && loadedFlags.length === 4) {
        reverseFlags = loadedFlags;
        logConsole(`Reverse flags loaded: ${reverseFlags.join(', ')}`);
        
        axisNames.forEach((name, i) => {
           const checkbox = document.getElementById(`reverse${name}`);
           if (checkbox) checkbox.checked = reverseFlags[i];
        });
      }
    } catch (e) {
      console.error("Error loading reverse flags", e);
    }
  }
}

function syncHardwareConfig() {
    for(let i=0; i<4; i++) {
        const physicalDriverIndex = motorMapping[i];
        sendCommand(`V ${physicalDriverIndex} ${reverseFlags[i] ? 1 : 0}`);
    }
    setSpeed();
    setAcceleration();
}

// --- Choreography Functions ---

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
      const physicalSteps = applyMapping(currentPositions);
      sendCommand(`M ${physicalSteps.join(' ')}`);
      axisNames.forEach((_, i) => updatePositionDisplay(i));
      
      keyframeIndex++;
    }
    
    if (keyframeIndex >= choreography.length) {
      const shouldLoop = document.getElementById('loopChoreography').checked;
      if (shouldLoop) {
        logConsole('Looping choreography...');
        playbackStartTime = Date.now();
        keyframeIndex = 0;
      } else {
        stopChoreography();
        logConsole('Choreography complete');
      }
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

// --- Virtual Box Logic ---

let boxState = {
  z: -300,
  roll: 0,
  pitch: 0
};

// Store the cable lengths at the "Home" position (0 steps)
let homeLengths = [0, 0, 0, 0];

function initVirtualBox() {
  // Use config logic
  const corners = calculateCorners({ z: PHYSICAL_Z_OFFSET, roll: 0, pitch: 0 });
  const motors = getMotorPositions();
  
  for (let i = 0; i < 4; i++) {
    homeLengths[i] = calculateDistance(motors[i], corners[i]);
  }
  console.log("Virtual Box Initialized. Home Lengths:", homeLengths);
}

function updateBoxDisplay() {
  const zInput = parseInt(document.getElementById('boxZ').value);
  const roll = parseInt(document.getElementById('boxRoll').value);
  const pitch = parseInt(document.getElementById('boxPitch').value);
  
  document.getElementById('valBoxZ').textContent = zInput;
  document.getElementById('valBoxRoll').textContent = roll + '°';
  document.getElementById('valBoxPitch').textContent = pitch + '°';
}

function updateBox() {
  const zInput = parseInt(document.getElementById('boxZ').value);
  const roll = parseInt(document.getElementById('boxRoll').value);
  const pitch = parseInt(document.getElementById('boxPitch').value);
  
  const z = zInput + PHYSICAL_Z_OFFSET;
  
  updateBoxDisplay();
  
  boxState = { z, roll, pitch };
  
  // Use kinematics module
  const targetSteps = calculateTargetSteps(boxState, homeLengths);
  
  for(let i=0; i<4; i++) {
     currentPositions[i] = targetSteps[i];
     updatePositionDisplay(i);
  }
  
  const physicalSteps = applyMapping(targetSteps);
  sendCommand(`M ${physicalSteps.join(' ')}`);
}

function resetBox() {
  document.getElementById('boxZ').value = 0;
  document.getElementById('boxRoll').value = 0;
  document.getElementById('boxPitch').value = 0;
  updateBox();
}

function resetRoll() {
  document.getElementById('boxRoll').value = 0;
  updateBox();
}

function resetPitch() {
  document.getElementById('boxPitch').value = 0;
  updateBox();
}

function setHomeAsReference() {
  sendCommand('H'); // Tell Arduino this is 0
  currentPositions = [0, 0, 0, 0];
  visualPositions = [0, 0, 0, 0]; // Snap visual to 0
  motorVelocities = [0, 0, 0, 0];
  
  axisNames.forEach(name => {
      const slider = document.getElementById(`slider${name}`);
      if(slider) slider.value = 0;
      updatePositionDisplay(axisNames.indexOf(name));
  });
  
  document.getElementById('boxZ').value = 0;
  document.getElementById('boxRoll').value = 0;
  document.getElementById('boxPitch').value = 0;
  
  initVirtualBox();
  
  logConsole("Home Reference Set. Box at Z=0 (Phys -900), Level.");
}

function syncUI() {
  const speedSlider = document.getElementById('choreoSpeed');
  if (speedSlider) {
    speedSlider.value = playbackSpeed;
    document.getElementById('speedDisplay').textContent = playbackSpeed + 'x';
  }
  
  document.getElementById('boxZ').value = 0;
  document.getElementById('boxRoll').value = 0;
  document.getElementById('boxPitch').value = 0;
  document.getElementById('valBoxZ').textContent = 0;
  document.getElementById('valBoxRoll').textContent = '0°';
  document.getElementById('valBoxPitch').textContent = '0°';
  
  for(let i=0; i<4; i++) {
    updatePositionDisplay(i);
  }
}

// --- Initialization ---

window.toggleMappingPanel = toggleMappingPanel;
window.updateMapping = updateMapping;
window.quickMove = quickMove;
window.moveAllMotors = moveAllMotors;
window.moveToSlider = moveToSlider;
window.updateSliderDisplay = updateSliderDisplay;
window.toggleReverse = toggleReverse;
window.homeAll = homeAll;
window.setFloor = setFloor;
window.toggleMotors = toggleMotors;
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
window.resetBox = resetBox;
window.resetRoll = resetRoll;
window.resetPitch = resetPitch;
window.setHomeAsReference = setHomeAsReference;
window.updateBoxDisplay = updateBoxDisplay;
window.updateBox = updateBox;

document.addEventListener('DOMContentLoaded', () => {
  loadMapping();
  loadReverseFlags();
  initVirtualBox();
  syncUI();
  connectWebSocket();
});