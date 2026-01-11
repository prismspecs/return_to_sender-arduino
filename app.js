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
    
    // Threshold to stop (Increased to 0.5 to prevent display flicker)
    if (Math.abs(diff) < 0.5 && Math.abs(motorVelocities[i]) < 10) {
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
// let choreographyStartTime = 0; // Removed, using currentTime
let currentTime = 0; // Current playhead time in seconds
let playbackInterval = null;
let selectedKeyframeIndex = -1;
let maxCeiling = 900; // Default max height in mm
let currentFileName = "Untitled";

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
      // Clamp to 0-max range for visual display
      if (h < 0) h = 0;
      if (h > maxCeiling) h = maxCeiling;
      
      const percent = (h / maxCeiling) * 100;
      meter.style.height = `${percent}%`;
      
      // Update scale label if we want dynamic labels (optional, tricky with HTML structure)
      // For now just the bar scales dynamically
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

function updateSpeedUI(fromSlider) {
  const slider = document.getElementById('speedSlider');
  const input = document.getElementById('speed');
  if (fromSlider) {
    input.value = slider.value;
  } else {
    slider.value = input.value;
  }
}

function updateAccelUI(fromSlider) {
  const slider = document.getElementById('accelSlider');
  const input = document.getElementById('accel');
  if (fromSlider) {
    input.value = slider.value;
  } else {
    slider.value = input.value;
  }
}

function setSpeed() {
  const speedVal = document.getElementById('speed').value;
  // Ensure both are synced before sending
  document.getElementById('speedSlider').value = speedVal;
  
  const realSpeed = (parseFloat(speedVal) || 24) * 1000;
  uiMaxSpeed = realSpeed;
  sendCommand(`S ${realSpeed}`);
}

function setAcceleration() {
  const accelVal = document.getElementById('accel').value;
  document.getElementById('accelSlider').value = accelVal;
  
  const realAccel = (parseFloat(accelVal) || 24) * 1000;
  uiAcceleration = realAccel;
  sendCommand(`A ${realAccel}`);
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
  
  logConsole('Floor set (0).');
}

function setCeiling() {
  // Find the maximum current position in mm
  // Since positive steps = Up, we look for the max steps
  const maxSteps = Math.max(...currentPositions);
  const maxMm = maxSteps / VBOX_CONFIG.stepsPerMm;
  
  // Set ceiling slightly higher than current or exactly current?
  // Let's set it to current.
  maxCeiling = Math.max(100, maxMm); // Minimum 100mm to prevent div by zero/bugs
  
  // Update sliders max range if needed? 
  document.getElementById('boxZ').max = Math.ceil(maxCeiling);
  document.getElementById('editBoxZ').max = Math.ceil(maxCeiling);
  
  // Refresh meters
  for(let i=0; i<4; i++) updatePositionDisplay(i);
  
  logConsole(`Ceiling set to ${maxCeiling.toFixed(0)}mm`);
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

// --- Drag & Drop Logic ---
let isDraggingPlayhead = false;
let isDraggingKeyframe = false;
let draggedKeyframeIndex = -1;

document.addEventListener('mousemove', (e) => {
  if (isDraggingPlayhead) {
    handlePlayheadDrag(e);
  } else if (isDraggingKeyframe) {
    handleKeyframeDrag(e);
  }
});

document.addEventListener('mouseup', () => {
  if (isDraggingPlayhead) {
    isDraggingPlayhead = false;
  }
  if (isDraggingKeyframe) {
    isDraggingKeyframe = false;
    draggedKeyframeIndex = -1;
    // Resort and save on drop
    choreography.sort((a, b) => a.time - b.time);
    saveChoreographyToLocal();
    updateTimeline();
    updateKeyframesList();
  }
});

function handlePlayheadDrag(e) {
  const track = document.querySelector('.timeline-track');
  const rect = track.getBoundingClientRect();
  const PPS = 20;
  const x = e.clientX - rect.left;
  let t = x / PPS;
  if (t < 0) t = 0;
  
  currentTime = t;
  updatePlayhead(currentTime);
}

function handleKeyframeDrag(e) {
  if (draggedKeyframeIndex === -1) return;
  
  const track = document.querySelector('.timeline-track');
  const rect = track.getBoundingClientRect();
  const PPS = 20;
  const x = e.clientX - rect.left;
  let t = x / PPS;
  if (t < 0) t = 0;
  
  choreography[draggedKeyframeIndex].time = t;
  
  // Update marker position visually (without full resort yet)
  updateTimeline(); 
  
  // Also update editor time input if open
  if (selectedKeyframeIndex === draggedKeyframeIndex) {
      const editTime = document.getElementById('editTime');
      if(editTime) editTime.value = t.toFixed(2);
  }
}

// --- Choreography Functions ---

function saveChoreographyToLocal() {
  const data = {
      choreography: choreography,
      fileName: currentFileName
  };
  localStorage.setItem('choreographyData', JSON.stringify(data));
  // Keep legacy for safety or just overwrite? Let's use a new key to be clean.
  // Actually, let's just use the new object structure.
}

function loadChoreographyFromLocal() {
  const saved = localStorage.getItem('choreographyData');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      // Support both old array format and new object format
      if (Array.isArray(data)) {
          choreography = data;
          currentFileName = "Untitled";
      } else {
          choreography = data.choreography || [];
          currentFileName = data.fileName || "Untitled";
      }
      
      updateFileNameDisplay();
      updateKeyframesList();
      updateTimeline();
      logConsole(`Loaded ${choreography.length} keyframes (${currentFileName})`);
    } catch (e) {
      console.error("Error loading choreography", e);
    }
  }
}

function updateFileNameDisplay() {
    const el = document.getElementById('fileNameDisplay');
    if (el) el.textContent = `(${currentFileName})`;
}

function recordKeyframe() {
  // Use the current playhead time
  const time = currentTime;
  
  const keyframe = {
    time: time,
    positions: [...currentPositions],
    speed: uiMaxSpeed,
    accel: uiAcceleration,
    boxPose: { ...boxState } // Save current box state
  };
  
  choreography.push(keyframe);
  choreography.sort((a, b) => a.time - b.time);
  
  saveChoreographyToLocal();
  logConsole(`Keyframe recorded at ${time.toFixed(2)}s`);
  updateKeyframesList();
  updateTimeline();
}

function updateKeyframesList() {
  const list = document.getElementById('keyframesList');
  list.innerHTML = '';
  
  choreography.forEach((kf, index) => {
    const item = document.createElement('div');
    item.className = 'keyframe-item';
    const spd = kf.speed !== undefined ? (kf.speed/1000) + 'k' : 'def';
    const acc = kf.accel !== undefined ? (kf.accel/1000) + 'k' : 'def';
    
    if (index === selectedKeyframeIndex) {
        item.style.border = '2px solid var(--accent)';
        item.style.backgroundColor = '#e6f2ff';
    } else {
        item.style.border = 'none';
        item.style.backgroundColor = 'var(--bg-alt)';
    }

    item.innerHTML = `
      <span onclick="goToKeyframe(${index})" style="cursor: pointer; flex-grow: 1;">${kf.time.toFixed(2)}s: [${kf.positions.join(', ')}] <small>(S:${spd} A:${acc})</small></span>
      <button onclick="deleteKeyframe(${index})">Delete</button>
    `;
    list.appendChild(item);
  });
}

function openKeyframeEditor(index) {
  const kf = choreography[index];
  if (!kf) return;
  
  document.getElementById('keyframeEditor').style.display = 'block';
  document.getElementById('editTime').value = kf.time.toFixed(2);
  
  // Convert raw values (e.g. 24000) to UI values (e.g. 24)
  const spd = (kf.speed !== undefined ? kf.speed : uiMaxSpeed) / 1000;
  const acc = (kf.accel !== undefined ? kf.accel : uiAcceleration) / 1000;
  
  document.getElementById('editSpeed').value = spd;
  document.getElementById('editAccel').value = acc;
  
  for(let i=0; i<4; i++) {
      document.getElementById(`editM${i}`).value = kf.positions[i];
  }

  // Load Box Pose from keyframe if available, otherwise 0
  const z = kf.boxPose ? kf.boxPose.z - PHYSICAL_Z_OFFSET : 0; // Convert absolute Z to relative slider
  const roll = kf.boxPose ? kf.boxPose.roll : 0;
  const pitch = kf.boxPose ? kf.boxPose.pitch : 0;

  document.getElementById('editBoxZ').value = z;
  document.getElementById('editBoxRoll').value = roll;
  document.getElementById('editBoxPitch').value = pitch;
  
  document.getElementById('dispEditBoxZ').textContent = z;
  document.getElementById('dispEditBoxRoll').textContent = roll + '°';
  document.getElementById('dispEditBoxPitch').textContent = pitch + '°';
  
  updateKeyframesList(); 
  updateTimeline(); 
}

function updateEditorFromBox() {
  const z = document.getElementById('editBoxZ').value;
  const roll = document.getElementById('editBoxRoll').value;
  const pitch = document.getElementById('editBoxPitch').value;
  
  document.getElementById('dispEditBoxZ').textContent = z;
  document.getElementById('dispEditBoxRoll').textContent = roll + '°';
  document.getElementById('dispEditBoxPitch').textContent = pitch + '°';
  
  applyEditorBoxToMotors();
  saveKeyframeChanges();
}

function applyEditorBoxToMotors() {
  const zInput = parseInt(document.getElementById('editBoxZ').value);
  const roll = parseInt(document.getElementById('editBoxRoll').value);
  const pitch = parseInt(document.getElementById('editBoxPitch').value);
  
  const z = zInput + PHYSICAL_Z_OFFSET;
  const state = { z, roll, pitch };
  
  if (homeLengths[0] === 0) initVirtualBox();
  
  const targetSteps = calculateTargetSteps(state, homeLengths);
  
  for(let i=0; i<4; i++) {
     document.getElementById(`editM${i}`).value = targetSteps[i];
  }
}

function closeKeyframeEditor() {
  document.getElementById('keyframeEditor').style.display = 'none';
  selectedKeyframeIndex = -1;
  updateKeyframesList();
  updateTimeline();
}

function saveKeyframeChanges() {
  if (selectedKeyframeIndex === -1 || !choreography[selectedKeyframeIndex]) return;
  
  const time = parseFloat(document.getElementById('editTime').value);
  
  // Convert UI values (e.g. 24) back to raw values (e.g. 24000)
  const speed = parseInt(document.getElementById('editSpeed').value) * 1000;
  const accel = parseInt(document.getElementById('editAccel').value) * 1000;
  
  const positions = [
      parseInt(document.getElementById('editM0').value),
      parseInt(document.getElementById('editM1').value),
      parseInt(document.getElementById('editM2').value),
      parseInt(document.getElementById('editM3').value)
  ];

  // Capture current Editor Box State for storage
  const boxPose = {
      z: parseInt(document.getElementById('editBoxZ').value) + PHYSICAL_Z_OFFSET,
      roll: parseInt(document.getElementById('editBoxRoll').value),
      pitch: parseInt(document.getElementById('editBoxPitch').value)
  };
  
  choreography[selectedKeyframeIndex] = {
      time,
      speed,
      accel,
      positions,
      boxPose
  };
  
  choreography.sort((a, b) => a.time - b.time);
  saveChoreographyToLocal();
  updateKeyframesList();
  updateTimeline();
}

function getCurrentForEditor() {
  for(let i=0; i<4; i++) {
      document.getElementById(`editM${i}`).value = currentPositions[i];
  }
  // If getting current positions, we technically don't know the box pose anymore.
  // We could invalidate boxPose or leave it as is. Leaving it as is might be confusing if it doesn't match.
  // But we can't reverse solve it easily.
  saveKeyframeChanges();
}

function setTimeFromClick(e) {
  if (isPlaying) return; // Don't jump while playing for now
  
  const track = document.querySelector('.timeline-track');
  const rect = track.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const PPS = 20;
  
  let newTime = clickX / PPS;
  if (newTime < 0) newTime = 0;
  
  currentTime = newTime;
  updatePlayhead(currentTime);
  // logConsole(`Time set to ${currentTime.toFixed(2)}s`);
}

function updateTimeline() {
  const timeline = document.querySelector('.timeline'); // The scrollable container
  const track = document.querySelector('.timeline-track');
  const markers = track.querySelectorAll('.keyframe-marker:not(.playhead)');
  markers.forEach(m => m.remove());
  
  // Pixels per second determines the "zoom level" of the timeline
  const PPS = 20; 
  
  const maxTime = choreography.length > 0 ? Math.max(...choreography.map(kf => kf.time)) : 0;
  
  // Ensure we have enough width for the current time cursor too
  const timeToDisplay = Math.max(maxTime, currentTime);
  
  const requiredWidth = timeToDisplay * PPS + 200; // Extra padding
  const containerWidth = timeline.clientWidth;
  
  const finalWidth = Math.max(containerWidth, requiredWidth);
  track.style.width = `${finalWidth}px`;
  
  // Add click listener to track for setting time
  track.onclick = setTimeFromClick;
  
  // Ensure playhead is visible
  updatePlayhead(currentTime);
  
  if (choreography.length === 0) return;
  
  choreography.forEach((kf, index) => {
    const marker = document.createElement('div');
    marker.className = 'keyframe-marker';
    if (index === selectedKeyframeIndex) {
        marker.classList.add('selected');
    }
    
    marker.style.left = `${kf.time * PPS}px`;
    marker.title = `${kf.time.toFixed(2)}s`;
    
    // Drag Start
    marker.onmousedown = (e) => {
        e.stopPropagation();
        isDraggingKeyframe = true;
        draggedKeyframeIndex = index;
        selectedKeyframeIndex = index; // Select on drag start
        goToKeyframe(index); // Load data
    };
    
    track.appendChild(marker);
  });
}

function goToKeyframe(index) {
  const kf = choreography[index];
  
  // Update Editor UI only
  // We do NOT send physical commands to the robot anymore.
  
  // NOTE: If we want to preview speed/accel settings without moving, we could set them,
  // but it's safer to just show them in the editor.
  
  /* 
  // DISABLED PHYSICAL MOVEMENT ON EDIT CLICK
  currentPositions = [...kf.positions];
  if (kf.speed !== undefined) {
      uiMaxSpeed = kf.speed;
      document.getElementById('speed').value = uiMaxSpeed;
      document.getElementById('speedSlider').value = uiMaxSpeed;
      sendCommand(`S ${uiMaxSpeed}`);
  }
  if (kf.accel !== undefined) {
      uiAcceleration = kf.accel;
      document.getElementById('accel').value = uiAcceleration;
      document.getElementById('accelSlider').value = uiAcceleration;
      sendCommand(`A ${uiAcceleration}`);
  }
  
  sendCommand(`M ${currentPositions.join(' ')}`);
  axisNames.forEach((_, i) => updatePositionDisplay(i));
  */
  
  // logConsole(`Editing keyframe at ${kf.time.toFixed(2)}s`);
  
  selectedKeyframeIndex = index;
  openKeyframeEditor(index);
}

function deleteKeyframe(index) {
  choreography.splice(index, 1);
  saveChoreographyToLocal();
  updateKeyframesList();
  updateTimeline();
  logConsole(`Keyframe ${index} deleted`);
}

function clearChoreography() {
  choreography = [];
  saveChoreographyToLocal();
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
  // Calculate "wall clock" start time such that (Now - Start) * Speed = CurrentTime
  playbackStartTime = Date.now() - (currentTime * 1000 / playbackSpeed);
  
  document.getElementById('btnPlay').textContent = 'Pause';
  document.getElementById('btnPlay').classList.add('playing');
  
  logConsole('Playing choreography...');
  
  // Find next keyframe to play
  let keyframeIndex = 0;
  while(keyframeIndex < choreography.length && choreography[keyframeIndex].time <= currentTime) {
      keyframeIndex++;
  }
  
  playbackInterval = setInterval(() => {
    // Update currentTime based on wall clock
    currentTime = ((Date.now() - playbackStartTime) / 1000) * playbackSpeed;
    
    updatePlayhead(currentTime);
    
    // Execute keyframes that have just passed
    while (keyframeIndex < choreography.length && 
           choreography[keyframeIndex].time <= currentTime) {
      
      const kf = choreography[keyframeIndex];
      
      // Update Speed/Accel if present
      if (kf.speed !== undefined && kf.speed !== uiMaxSpeed) {
          uiMaxSpeed = kf.speed;
          const uiVal = uiMaxSpeed / 1000;
          document.getElementById('speed').value = uiVal;
          document.getElementById('speedSlider').value = uiVal;
          sendCommand(`S ${uiMaxSpeed}`);
      }
      if (kf.accel !== undefined && kf.accel !== uiAcceleration) {
          uiAcceleration = kf.accel;
          const uiVal = uiAcceleration / 1000;
          document.getElementById('accel').value = uiVal;
          document.getElementById('accelSlider').value = uiVal;
          sendCommand(`A ${uiAcceleration}`);
      }
      
      currentPositions = [...kf.positions];
      const physicalSteps = applyMapping(currentPositions);
      sendCommand(`M ${physicalSteps.join(' ')}`);
      axisNames.forEach((_, i) => updatePositionDisplay(i));
      
      keyframeIndex++;
    }
    
    // Check if loop is enabled
    const lastTime = choreography.length > 0 ? choreography[choreography.length - 1].time : 0;
    
    // Only check for loop/stop if we have actually passed the last keyframe
    // But we want to allow "recording space" so we won't auto-stop at the end.
    // We ONLY handle Loop logic here.
    
    if (currentTime > lastTime + 0.5) {
      const shouldLoop = document.getElementById('loopChoreography').checked;
      if (shouldLoop) {
        logConsole('Looping choreography...');
        currentTime = 0;
        playbackStartTime = Date.now();
        keyframeIndex = 0;
      }
      // Else: Continue playing indefinitely (User request)
    }
    
    // Ensure timeline track expands if playhead goes past current width
    const timeline = document.querySelector('.timeline');
    const track = document.querySelector('.timeline-track');
    if (timeline && track) {
        const PPS = 20;
        const requiredWidth = currentTime * PPS + 200;
        if (requiredWidth > track.offsetWidth) {
            track.style.width = `${requiredWidth}px`;
            // Auto-scroll to keep playhead in view?
            // Simple logic: if playhead is off screen right, scroll right.
            const playheadPos = currentTime * PPS;
            const scrollRight = timeline.scrollLeft + timeline.clientWidth;
            if (playheadPos > scrollRight - 50) {
                timeline.scrollLeft = playheadPos - timeline.clientWidth + 100;
            }
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
  // Do NOT remove playhead, keep current time
}

function updatePlayhead(time) {
  const track = document.querySelector('.timeline-track');
  if(!track) return;
  
  let playhead = track.querySelector('.playhead');
  
  if (!playhead) {
    playhead = document.createElement('div');
    playhead.className = 'playhead';
    
    // Drag Start for Playhead
    playhead.onmousedown = (e) => {
        e.stopPropagation();
        isDraggingPlayhead = true;
    };
    
    track.appendChild(playhead);
  }
  
  const PPS = 20; 
  playhead.style.left = `${time * PPS}px`;
  
  // Update Time Display
  const timeDisp = document.getElementById('timeDisplay');
  if(timeDisp) timeDisp.textContent = `${time.toFixed(2)}s`;
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
  // Use current filename or default with timestamp if Untitled
  let name = currentFileName;
  if (name === "Untitled") name = `choreography_${Date.now()}`;
  
  a.download = `${name}.json`;
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
      
      // Update Filename
      currentFileName = file.name.replace('.json', '');
      updateFileNameDisplay();
      saveChoreographyToLocal();
      
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

const JUMPER_CONFIGS = {
  A4988: [
    { val: 1, label: '1 (Full Step - No Jumpers)', jumpers: '---' },
    { val: 2, label: '1/2 (J1 only)', jumpers: 'H--' },
    { val: 4, label: '1/4 (J2 only)', jumpers: '-H-' },
    { val: 8, label: '1/8 (J1 & J2)', jumpers: 'HH-' },
    { val: 16, label: '1/16 (All 3 Jumpers)', jumpers: 'HHH' }
  ],
  DRV8825: [
    { val: 1, label: '1 (Full Step - No Jumpers)', jumpers: '---' },
    { val: 2, label: '1/2 (J1 only)', jumpers: 'H--' },
    { val: 4, label: '1/4 (J2 only)', jumpers: '-H-' },
    { val: 8, label: '1/8 (J1 & J2)', jumpers: 'HH-' },
    { val: 16, label: '1/16 (J3 only)', jumpers: '--H' },
    { val: 32, label: '1/32 (All 3 Jumpers)', jumpers: 'HHH' }
  ]
};

function updateMicrosteppingOptions() {
  const driverSelect = document.getElementById('driverType');
  const msSelect = document.getElementById('microstepping');
  const driver = driverSelect.value;
  
  localStorage.setItem('driverType', driver);
  
  // Save current value to try and restore it
  const currentVal = parseInt(msSelect.value) || VBOX_CONFIG.microsteps;
  
  msSelect.innerHTML = '';
  JUMPER_CONFIGS[driver].forEach(cfg => {
    const opt = document.createElement('option');
    opt.value = cfg.val;
    opt.textContent = cfg.label;
    msSelect.appendChild(opt);
  });
  
  // Restore value if it exists in new list, else use default for driver
  if ([...msSelect.options].some(o => parseInt(o.value) === currentVal)) {
    msSelect.value = currentVal;
  } else {
    msSelect.value = JUMPER_CONFIGS[driver][JUMPER_CONFIGS[driver].length - 1].val;
  }
  
  updateMicrostepping();
}

function updateMicrostepping() {
  const select = document.getElementById('microstepping');
  const ms = parseInt(select.value);
  VBOX_CONFIG.microsteps = ms;
  localStorage.setItem('microsteps', ms);
  logConsole(`Microstepping set to 1/${ms}. Steps/mm: ${VBOX_CONFIG.stepsPerMm.toFixed(2)}`);
}

function loadMicrostepping() {
  const savedDriver = localStorage.getItem('driverType');
  if (savedDriver) {
    document.getElementById('driverType').value = savedDriver;
  }
  
  updateMicrosteppingOptions(); // This populates the list

  const savedMs = localStorage.getItem('microsteps');
  if (savedMs) {
    const ms = parseInt(savedMs);
    const select = document.getElementById('microstepping');
    if (select && [...select.options].some(o => parseInt(o.value) === ms)) {
      select.value = ms;
      VBOX_CONFIG.microsteps = ms;
    }
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
window.updateSpeedUI = updateSpeedUI;
window.updateAccelUI = updateAccelUI;
window.updateMicrostepping = updateMicrostepping;
window.updateMicrosteppingOptions = updateMicrosteppingOptions;
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
window.saveKeyframeChanges = saveKeyframeChanges;
window.closeKeyframeEditor = closeKeyframeEditor;
window.getCurrentForEditor = getCurrentForEditor;
window.updateEditorFromBox = updateEditorFromBox;
window.applyEditorBoxToMotors = applyEditorBoxToMotors;

document.addEventListener('DOMContentLoaded', () => {
  loadMapping();
  loadReverseFlags();
  loadMicrostepping();
  initVirtualBox();
  syncUI();
  connectWebSocket();
  loadChoreographyFromLocal();
});