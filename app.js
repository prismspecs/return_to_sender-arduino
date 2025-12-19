let ws = null;
let currentPositions = [0, 0, 0, 0];
let reverseFlags = [false, false, false, false];
let motorMapping = [0, 1, 3, 2]; // Default: M1->X, M2->Y, M3->A, M4->Z
const axisNames = ['X', 'Y', 'Z', 'A'];

// Mapping Functions
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
  // logicalSteps is [M1, M2, M3, M4]
  // motorMapping is [DriverForM1, DriverForM2, DriverForM3, DriverForM4]
  // We want physicalSteps[DriverIndex] = logicalSteps[LogicalIndex]
  
  for (let i = 0; i < 4; i++) {
    const driverIndex = motorMapping[i];
    physicalSteps[driverIndex] = logicalSteps[i];
  }
  return physicalSteps;
}

function reverseMappingIndex(physicalDriverIndex) {
  // Find which Logical Motor maps to this Physical Driver
  return motorMapping.indexOf(physicalDriverIndex);
}

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
    // Request status update on connection
    setTimeout(() => sendCommand('I'), 1000);
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
          // Query status immediately when Arduino connects
          setTimeout(() => sendCommand('I'), 500);
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
    const physicalAxisChar = posMatch[1];
    const physicalAxisIndex = axisNames.indexOf(physicalAxisChar);
    
    if (physicalAxisIndex !== -1) {
      // Map back to Logical Motor
      const logicalAxisIndex = reverseMappingIndex(physicalAxisIndex);
      
      if (logicalAxisIndex !== -1) {
        currentPositions[logicalAxisIndex] = parseInt(posMatch[2]);
        updatePositionDisplay(logicalAxisIndex);
      }
    }
  }

  // Check for motor status
  if (message.includes("Motors: ENABLED")) {
    document.getElementById('motorToggle').checked = true;
    areMotorsEnabled = true;
  } else if (message.includes("Motors: DISABLED")) {
    document.getElementById('motorToggle').checked = false;
    areMotorsEnabled = false;
  }

  // Check for inversion status
  // Format: Inverted: X=1 Y=0 Z=1 A=0
  if (message.includes("Inverted:")) {
    const parts = message.split('Inverted: ')[1].trim().split(' ');
    parts.forEach(part => {
      const [axisName, state] = part.split('=');
      const physicalAxisIndex = axisNames.indexOf(axisName);
      if (physicalAxisIndex !== -1) {
        const isInverted = (state === '1');
        
        // Map physical axis to logical motor to update UI
        const logicalAxisIndex = reverseMappingIndex(physicalAxisIndex);
        if (logicalAxisIndex !== -1) {
          // Update UI Checkbox
          const checkbox = document.getElementById(`reverse${axisNames[logicalAxisIndex]}`);
          if (checkbox) {
            // Prevent triggering onchange event loop
            checkbox.checked = isInverted;
            reverseFlags[logicalAxisIndex] = isInverted;
          }
        }
      }
    });
    logConsole("Synced inversion status from Arduino");
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
  
  // Note: We do NOT negate targetPosition based on reverseFlags here anymore.
  // The Arduino handles the inversion physically via 'V' command.
  // However, if the slider is showing a "Reversed" value (negative), 
  // and we want to send the absolute position to Arduino...
  
  // If reverse is ON, the slider shows -100. The user drags to -200.
  // We want the motor to go to position 200 (physically).
  // So if reverse is ON, we negate the slider value to get the physical target.
  
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
  
  const physicalSteps = applyMapping(positions);
  sendCommand(`M ${physicalSteps.join(' ')}`);
  currentPositions[axisIndex] = value;
  updatePositionDisplay(axisIndex);
}

function moveRelative(axisName, axisIndex) {
  const inputId = `${axisName.toLowerCase()}Relative`;
  const value = parseInt(document.getElementById(inputId).value);
  
  const relative = [0, 0, 0, 0];
  relative[axisIndex] = value;
  
  const physicalRelative = applyMapping(relative);
  sendCommand(`R ${physicalRelative.join(' ')}`);
  currentPositions[axisIndex] += value;
  updatePositionDisplay(axisIndex);
}

function quickMove(axisName, axisIndex, steps) {
  let moveSteps = steps;
  
  // If Arduino handles inversion, we do NOT negate steps here.
  // Sending "+100" to an inverted motor (via setPinsInverted) moves it "Forward".
  // If we negate it to "-100", it would move "Backward".
  // So we remove the software negation.
  
  // if (reverseFlags[axisIndex]) {
  //   moveSteps = -steps;
  // }
  
  const relative = [0, 0, 0, 0];
  relative[axisIndex] = moveSteps;
  
  const physicalRelative = applyMapping(relative);
  sendCommand(`R ${physicalRelative.join(' ')}`);
  
  currentPositions[axisIndex] += moveSteps;
  updatePositionDisplay(axisIndex);
}

function moveAllMotors(steps) {
  console.log(`moveAllMotors called with steps: ${steps}`);
  
  const relative = [0, 0, 0, 0];
  
  for (let i = 0; i < 4; i++) {
    let moveSteps = steps;
    // Remove software inversion
    // if (reverseFlags[i]) {
    //   moveSteps = -steps;
    // }
    relative[i] = moveSteps;
    currentPositions[i] += moveSteps;
  }
  
  console.log(`Sending command: R ${relative.join(' ')}`);
  const physicalRelative = applyMapping(relative);
  sendCommand(`R ${physicalRelative.join(' ')}`);
  
  axisNames.forEach((_, index) => updatePositionDisplay(index));
  logConsole(`All motors: moved ${steps} steps`);
}

function moveAllToZero() {
  console.log('moveAllToZero called');
  
  // Set all internal positions to 0
  currentPositions = [0, 0, 0, 0];
  
  // Send absolute move to 0,0,0,0
  // Note: applyMapping([0,0,0,0]) is just [0,0,0,0] regardless of mapping,
  // but good to be consistent.
  const physicalSteps = applyMapping([0, 0, 0, 0]);
  sendCommand(`M ${physicalSteps.join(' ')}`);
  
  axisNames.forEach((_, index) => updatePositionDisplay(index));
  logConsole('All motors: moving to 0');
}

function setSpeed() {
  const speed = document.getElementById('speed').value;
  sendCommand(`S${speed}`);
}

function setAcceleration() {
  const accel = document.getElementById('accel').value;
  sendCommand(`A${accel}`);
}

let areMotorsEnabled = false;

function homeAll() {
  sendCommand('H');
  currentPositions = [0, 0, 0, 0];
  axisNames.forEach((_, index) => updatePositionDisplay(index));

  // Ensure motors are engaged for homing
  if (!areMotorsEnabled) {
    document.getElementById('motorToggle').checked = true;
    toggleMotors(true);
    logConsole('Motors automatically engaged for homing.');
  }
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
  // Update local flag immediately for UI responsiveness
  reverseFlags[logicalAxisIndex] = checked;
  
  // Find physical driver
  const physicalDriverIndex = motorMapping[logicalAxisIndex];
  
  // Send command to Arduino to update hardware inversion
  // Command: V <axis_index> <state>
  sendCommand(`V ${physicalDriverIndex} ${checked ? 1 : 0}`);
  
  logConsole(`${axisNames[logicalAxisIndex]}-axis (Driver ${axisNames[physicalDriverIndex]}) reverse: ${checked ? 'ON' : 'OFF'}`);
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  
  setTimeout(() => {
    sendCommand('I');
  }, 2000);
});

// --- Virtual Box Logic ---

const VBOX_CONFIG = {
  frameWidth: 560,  // Distance between motors Left/Right
  frameLength: 400, // Distance between motors Front/Rear
  boxWidth: 450,    // Distance between corners X
  boxLength: 350,   // Distance between corners Y
  
  // Motor & Spool Physics
  spoolDiameter: 35,      // Diameter of the spool in mm
  motorStepsPerRev: 200,  // Steps per full revolution (usually 200 for NEMA 17)
  microsteps: 1,          // Microstepping setting (1, 2, 4, 8, 16, 32)
  
  // Dynamic calculation: Steps required to move 1mm
  get stepsPerMm() {
    const circumference = Math.PI * this.spoolDiameter;
    return (this.motorStepsPerRev * this.microsteps) / circumference;
  }
};

let boxState = {
  z: -300,
  roll: 0,
  pitch: 0
};

// Store the cable lengths at the "Home" position (0 steps)
let homeLengths = [0, 0, 0, 0];

// Initialize home lengths based on default state
function initVirtualBox() {
  // Calculate lengths at default position (Z=-300, Roll=0, Pitch=0)
  // This assumes that when the system starts (0 steps), the box is at this position.
  const corners = calculateCorners({ z: -300, roll: 0, pitch: 0 });
  const motors = getMotorPositions();
  
  for (let i = 0; i < 4; i++) {
    homeLengths[i] = calculateDistance(motors[i], corners[i]);
  }
  console.log("Virtual Box Initialized. Home Lengths:", homeLengths);
}

function getMotorPositions() {
  const w = VBOX_CONFIG.frameWidth / 2;
  const l = VBOX_CONFIG.frameLength / 2;
  
  // Standard Motor Mapping (Clockwise from Rear-Left)
  // M1 (X-Axis): Rear-Left    (-X, +Y)
  // M2 (Y-Axis): Rear-Right   (+X, +Y)
  // M3 (Z-Axis): Front-Right  (+X, -Y)
  // M4 (A-Axis): Front-Left   (-X, -Y)
  
  return [
    { x: -w, y: l, z: 0 },  // M1 (RL)
    { x: w, y: l, z: 0 },   // M2 (RR)
    { x: w, y: -l, z: 0 },  // M3 (FR)
    { x: -w, y: -l, z: 0 }  // M4 (FL)
  ];
}

function calculateCorners(state) {
  const w = VBOX_CONFIG.boxWidth / 2;
  const l = VBOX_CONFIG.boxLength / 2;
  
  // Local corners relative to box center (Same order as motors)
  const localCorners = [
    { x: -w, y: l, z: 0 },  // C1 (RL)
    { x: w, y: l, z: 0 },   // C2 (RR)
    { x: w, y: -l, z: 0 },  // C3 (FR)
    { x: -w, y: -l, z: 0 }  // C4 (FL)
  ];
  
  const radRoll = state.roll * Math.PI / 180;
  const radPitch = state.pitch * Math.PI / 180;
  
  return localCorners.map(p => {
    // Apply Roll (X-axis rotation)
    let y1 = p.y * Math.cos(radRoll) - p.z * Math.sin(radRoll);
    let z1 = p.y * Math.sin(radRoll) + p.z * Math.cos(radRoll);
    let x1 = p.x;
    
    // Apply Pitch (Y-axis rotation)
    let x2 = x1 * Math.cos(radPitch) + z1 * Math.sin(radPitch);
    let z2 = -x1 * Math.sin(radPitch) + z1 * Math.cos(radPitch);
    let y2 = y1;
    
    // Translate to Box Center
    return {
      x: x2,
      y: y2,
      z: z2 + state.z
    };
  });
}

function calculateDistance(p1, p2) {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) +
    Math.pow(p1.y - p2.y, 2) +
    Math.pow(p1.z - p2.z, 2)
  );
}

function updateBox() {
  const z = parseInt(document.getElementById('boxZ').value);
  const roll = parseInt(document.getElementById('boxRoll').value);
  const pitch = parseInt(document.getElementById('boxPitch').value);
  
  document.getElementById('valBoxZ').textContent = z;
  document.getElementById('valBoxRoll').textContent = roll + '°';
  document.getElementById('valBoxPitch').textContent = pitch + '°';
  
  boxState = { z, roll, pitch };
  
  const corners = calculateCorners(boxState);
  const motors = getMotorPositions();
  const targetSteps = [];
  
  for (let i = 0; i < 4; i++) {
    const len = calculateDistance(motors[i], corners[i]);
    // Calculate steps relative to home length
    // If length increases, we need to unspool (positive steps? or negative?)
    // Usually "Raise" means pull up -> shorter cable.
    // If cable is shorter, we need to retract.
    // Let's assume Positive Steps = Retract (Pull Up).
    // So Steps = (HomeLength - CurrentLength) * StepsPerMm
    // Wait, if Length < HomeLength, we pulled up. Steps should be positive?
    // Let's assume standard: Positive Steps = Move Motor Forward.
    // We need to know if Forward = Retract or Extend.
    // Usually Forward = Retract (Pull).
    // So: Steps = (HomeLength - TargetLength) * StepsPerMm
    // But wait, if we start at Home (0 steps), and we want to go to a position with Shorter Cable,
    // we need Positive Steps.
    // So: Steps = (homeLengths[i] - len) * VBOX_CONFIG.stepsPerMm;
    
    // However, the prompt says "Raise Corner 1... Move Motor 1 up 100".
    // Let's assume Positive Steps = Retract.
    
    let steps = (homeLengths[i] - len) * VBOX_CONFIG.stepsPerMm;
    let finalSteps = Math.round(steps);
    
    // Apply reverse flag if set
    // REMOVED: Hardware inversion handles this now.
    // if (reverseFlags[i]) {
    //   finalSteps = -finalSteps;
    // }
    
    targetSteps.push(finalSteps);
  }
  
  // Send command
  // Note: We are sending absolute steps relative to Home.
  // The Arduino 'M' command takes absolute steps.
  // So this matches perfectly.
  
  // Update global currentPositions to match (so UI stays in sync)
  // But wait, the sliders in UI are for individual motors.
  // We should update them too?
  // Yes, let's update the sliders to reflect the new positions.
  
  for(let i=0; i<4; i++) {
     // Update internal state
     currentPositions[i] = targetSteps[i];
     // Update the slider UI and text display
     updatePositionDisplay(i);
  }
  
  const physicalSteps = applyMapping(targetSteps);
  sendCommand(`M ${physicalSteps.join(' ')}`);
}

function resetBox() {
  document.getElementById('boxZ').value = -300;
  document.getElementById('boxRoll').value = 0;
  document.getElementById('boxPitch').value = 0;
  updateBox();
}

function setHomeAsReference() {
  // Recalculate homeLengths based on current boxState being the "0 steps" state.
  // Actually, usually "Set Home" means "Current Physical Position is 0,0,0,0".
  // And we want to associate that with the current Box State.
  
  // For simplicity, let's just reset the box state to default and say "This is Home".
  // Or, if the user manually moved motors to a perfect level position, they click this.
  
  // Let's assume the user manually leveled the box.
  // We set the current physical motor positions to 0 (sendCommand('H')).
  // And we set the virtual box state to default (-300, 0, 0).
  // And we recalculate homeLengths.
  
  sendCommand('H'); // Tell Arduino this is 0
  currentPositions = [0, 0, 0, 0];
  
  // Reset UI sliders
  axisNames.forEach(name => {
      const slider = document.getElementById(`slider${name}`);
      if(slider) slider.value = 0;
      updatePositionDisplay(axisNames.indexOf(name));
  });
  
  // Reset Box UI
  document.getElementById('boxZ').value = -300;
  document.getElementById('boxRoll').value = 0;
  document.getElementById('boxPitch').value = 0;
  
  // Recalculate Home Lengths
  initVirtualBox();
  
  logConsole("Home Reference Set. Box at Z=-300, Level.");
}

// Initialize on load
window.addEventListener('load', () => {
  loadMapping();
  initVirtualBox();
});

