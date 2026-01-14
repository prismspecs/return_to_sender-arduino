import { 
    VBOX_CONFIG, 
    PHYSICAL_Z_OFFSET, 
    AXIS_NAMES 
} from './config.js';

import { state } from './state.js';
import * as Comms from './comms.js';
import * as Storage from './storage.js';
import * as Choreo from './choreography.js';
import * as UI from './ui.js';
import { 
    getMotorPositions, 
    calculateCorners, 
    calculateDistance,
    calculateTargetSteps 
} from './kinematics.js';

// --- Callbacks ---
const choreoCallbacks = {
    onTimeUpdate: (t) => UI.updatePlayhead(t),
    onPositionUpdate: () => { 
        for(let i=0; i<4; i++) updatePositionDisplay(i); 
    },
    onPlayStateChange: (playing) => {
        const btn = document.getElementById('btnPlay');
        if(playing) {
            btn.textContent = 'Pause';
            btn.classList.add('playing');
        } else {
            btn.textContent = 'Play';
            btn.classList.remove('playing');
        }
    },
    onSettingsUpdate: (speed, accel) => {
        if(speed) {
            const val = speed/1000;
            document.getElementById('speed').value = val;
            document.getElementById('speedSlider').value = val;
        }
        if(accel) {
            const val = accel/1000;
            document.getElementById('accel').value = val;
            document.getElementById('accelSlider').value = val;
        }
    }
};

const uiCallbacks = {
    onDelete: (index) => {
        state.choreography.splice(index, 1);
        Storage.saveChoreographyToLocal();
        refreshUI();
    },
    onSelect: (index) => {
        goToKeyframe(index);
    },
    onKeyframeDragStart: (index) => {
        state.isDraggingKeyframe = true;
        state.draggedKeyframeIndex = index;
        goToKeyframe(index); 
    }
};

// --- Helper Functions ---
function initVirtualBox() {
  const corners = calculateCorners({ z: PHYSICAL_Z_OFFSET, roll: 0, pitch: 0 });
  const motors = getMotorPositions();
  for (let i = 0; i < 4; i++) {
    state.homeLengths[i] = calculateDistance(motors[i], corners[i]);
  }
}

function applyMapping(logicalSteps) {
  const physicalSteps = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const driverIndex = state.motorMapping[i];
    physicalSteps[driverIndex] = logicalSteps[i];
  }
  return physicalSteps;
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
  const currentVal = parseInt(msSelect.value) || VBOX_CONFIG.microsteps;
  msSelect.innerHTML = '';
  JUMPER_CONFIGS[driver].forEach(cfg => {
    const opt = document.createElement('option');
    opt.value = cfg.val;
    opt.textContent = cfg.label;
    msSelect.appendChild(opt);
  });
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
}

function loadMicrostepping() {
  const savedDriver = localStorage.getItem('driverType');
  if (savedDriver) document.getElementById('driverType').value = savedDriver;
  updateMicrosteppingOptions(); 
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

// --- Main UI Refresh ---
function refreshUI() {
    UI.updateKeyframesList(uiCallbacks);
    UI.updateTimeline(uiCallbacks);
    UI.updateFileNameDisplay();
}

function updateQuickSaveDropdown(projects) {
    const select = document.getElementById('quickSaveSelect');
    if (!select) return;
    select.innerHTML = '';
    projects.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
    if (projects.includes(state.currentFileName)) select.value = state.currentFileName;
}

// --- Animation Loop ---
let lastFrameTime = 0;
function animateDisplay(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = (timestamp - lastFrameTime) / 1000;
  lastFrameTime = timestamp;

  const isSmooth = document.getElementById('smoothAnimation')?.checked;

  if (!isSmooth) {
    for (let i = 0; i < 4; i++) {
        state.visualPositions[i] = state.currentPositions[i];
    }
    for (let i = 0; i < 4; i++) updatePositionDisplay(i);
    requestAnimationFrame(animateDisplay);
    return;
  }

  let changed = false;
  for (let i = 0; i < 4; i++) {
    const target = state.currentPositions[i];
    const current = state.visualPositions[i];
    const diff = target - current;
    
    if (Math.abs(diff) < 0.5 && Math.abs(state.motorVelocities[i]) < 10) {
      if (state.visualPositions[i] !== target) {
        state.visualPositions[i] = target;
        state.motorVelocities[i] = 0;
        changed = true;
      }
      continue;
    }

    const maxSpeed = state.uiMaxSpeed;
    const acceleration = state.uiAcceleration;
    const safeSpeed = Math.sqrt(2 * acceleration * Math.abs(diff));
    let targetVel = Math.sign(diff) * Math.min(maxSpeed, safeSpeed);

    const velDiff = targetVel - state.motorVelocities[i];
    const maxVelChange = acceleration * dt;
    
    if (Math.abs(velDiff) < maxVelChange) {
      state.motorVelocities[i] = targetVel;
    } else {
      state.motorVelocities[i] += Math.sign(velDiff) * maxVelChange;
    }

    state.visualPositions[i] += state.motorVelocities[i] * dt;
    changed = true;
  }

  if (changed) {
    for (let i = 0; i < 4; i++) updatePositionDisplay(i);
  }

  requestAnimationFrame(animateDisplay);
}

function updatePositionDisplay(motorIndex) {
  const physicalAxisIndex = state.motorMapping[motorIndex];
  const displayId = `pos${AXIS_NAMES[physicalAxisIndex]}`;
  let displayValue = Math.round(state.visualPositions[motorIndex]);
  if (state.reverseFlags[physicalAxisIndex]) displayValue = -displayValue;
  
  const displayEl = document.getElementById(displayId);
  if(displayEl) displayEl.textContent = displayValue;
  
  const h = state.visualPositions[motorIndex] / VBOX_CONFIG.stepsPerMm;
  const meter = document.getElementById(`altM${motorIndex}`);
  if (meter) {
      let val = h;
      if (val < 0) val = 0;
      if (val > state.maxCeiling) val = state.maxCeiling;
      meter.style.height = `${(val / state.maxCeiling) * 100}%`;
  }
}

// --- Global Functions ---
window.quickMove = (axisName, axisIndex, distanceMm) => {
  const steps = Math.round(distanceMm * VBOX_CONFIG.stepsPerMm);
  state.currentPositions[axisIndex] += steps;
  const physRel = [0,0,0,0];
  const relative = [0,0,0,0];
  relative[axisIndex] = steps;
  for(let i=0; i<4; i++) physRel[state.motorMapping[i]] = relative[i];
  Comms.sendCommand(`R ${physRel.join(' ')}`);
  updatePositionDisplay(axisIndex);
};

window.moveToSlider = (axisName, axisIndex, value) => {
    let target = parseInt(value);
    const phys = state.motorMapping[axisIndex];
    if (state.reverseFlags[phys]) target = -target;
    state.currentPositions[axisIndex] = target;
    const physicalSteps = [0,0,0,0];
    for(let i=0; i<4; i++) physicalSteps[state.motorMapping[i]] = state.currentPositions[i];
    Comms.sendCommand(`M ${physicalSteps.join(' ')}`);
    updatePositionDisplay(axisIndex);
};

window.moveAllMotors = (dist) => {
    const steps = Math.round(dist * VBOX_CONFIG.stepsPerMm);
    for(let i=0; i<4; i++) state.currentPositions[i] += steps;
    const physRel = [0,0,0,0];
    for(let i=0; i<4; i++) physRel[state.motorMapping[i]] = steps;
    Comms.sendCommand(`R ${physRel.join(' ')}`);
    for(let i=0; i<4; i++) updatePositionDisplay(i);
};

window.moveAllToZero = () => {
    state.currentPositions = [0,0,0,0];
    Comms.sendCommand(`M 0 0 0 0`);
    for(let i=0; i<4; i++) updatePositionDisplay(i);
};

window.toggleReverse = (logicalIndex, checked) => {
    state.reverseFlags[logicalIndex] = checked;
    localStorage.setItem('reverseFlags', JSON.stringify(state.reverseFlags));
    const phys = state.motorMapping[logicalIndex];
    Comms.sendCommand(`V ${phys} ${checked ? 1 : 0}`);
};

window.toggleMotors = (checked) => {
    if (checked) {
        Comms.sendCommand('E 1');
    } else {
        Comms.sendCommand('E 0');
        window.setFloor();
    }
};

window.setFloor = () => {
    Comms.sendCommand('H');
    state.currentPositions = [0,0,0,0];
    for(let i=0; i<4; i++) updatePositionDisplay(i);
    document.getElementById('boxZ').value = 0;
    document.getElementById('boxRoll').value = 0;
    document.getElementById('boxPitch').value = 0;
    window.updateBoxDisplay();
    initVirtualBox();
};

window.setCeiling = () => {
    const maxSteps = Math.max(...state.currentPositions);
    state.maxCeiling = Math.max(100, maxSteps / VBOX_CONFIG.stepsPerMm);
    document.getElementById('boxZ').max = Math.ceil(state.maxCeiling);
    document.getElementById('editBoxZ').max = Math.ceil(state.maxCeiling);
    for(let i=0; i<4; i++) updatePositionDisplay(i);
};

window.haltMotors = () => {
    Comms.sendCommand('Q');
    if(state.isPlaying) Choreo.stopChoreography(choreoCallbacks);
    setTimeout(() => Comms.sendCommand('I'), 250);
};

window.setSpeed = () => {
    const val = document.getElementById('speed').value;
    document.getElementById('speedSlider').value = val;
    state.uiMaxSpeed = (parseFloat(val) || 24) * 1000;
    Comms.sendCommand(`S ${state.uiMaxSpeed}`);
};

window.setAcceleration = () => {
    const val = document.getElementById('accel').value;
    document.getElementById('accelSlider').value = val;
    state.uiAcceleration = (parseFloat(val) || 24) * 1000;
    Comms.sendCommand(`A ${state.uiAcceleration}`);
};

window.updateSpeedUI = (fromSlider) => {
    const s = document.getElementById('speedSlider');
    const i = document.getElementById('speed');
    if(fromSlider) i.value = s.value; else s.value = i.value;
};

window.updateAccelUI = (fromSlider) => {
    const s = document.getElementById('accelSlider');
    const i = document.getElementById('accel');
    if(fromSlider) i.value = s.value; else s.value = i.value;
};

window.recordKeyframe = () => {
    const kf = {
        time: state.currentTime,
        positions: [...state.currentPositions],
        speed: state.uiMaxSpeed,
        accel: state.uiAcceleration,
        boxPose: { ...state.boxState }
    };
    state.choreography.push(kf);
    state.choreography.sort((a,b) => a.time - b.time);
    Storage.saveChoreographyToLocal();
    refreshUI();
};

window.playChoreography = () => Choreo.playChoreography(choreoCallbacks);
window.stopChoreography = () => Choreo.stopChoreography(choreoCallbacks);
window.clearChoreography = () => {
    state.choreography = [];
    Storage.saveChoreographyToLocal();
    refreshUI();
};

window.quickSave = () => {
    if(Storage.quickSave()) {
        Storage.refreshQuickSaveList(updateQuickSaveDropdown);
    }
};
window.quickLoad = () => {
    const name = document.getElementById('quickSaveSelect').value;
    if(Storage.quickLoad(name, { onLoaded: refreshUI })) {
        refreshUI();
    }
};
window.quickDelete = () => {
    const name = document.getElementById('quickSaveSelect').value;
    if(confirm(`Delete ${name}?`)) {
        Storage.quickDelete(name);
        Storage.refreshQuickSaveList(updateQuickSaveDropdown);
    }
};

window.openSaveDialog = () => {
    document.getElementById('saveDialog').style.display = 'flex';
    document.getElementById('saveFileName').value = state.currentFileName;
};
window.closeSaveDialog = () => document.getElementById('saveDialog').style.display = 'none';
window.confirmSave = () => {
    const name = document.getElementById('saveFileName').value.trim();
    if(name) {
        state.currentFileName = name;
        Storage.saveChoreographyToLocal();
        const data = localStorage.getItem('choreographyData');
        const blob = new Blob([data], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${name}.json`; a.click();
        window.closeSaveDialog();
    }
};
window.loadChoreography = () => document.getElementById('fileInput').click();
window.handleFileLoad = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            state.choreography = data.choreography || [];
            state.currentFileName = file.name.replace('.json','');
            Storage.saveChoreographyToLocal();
            refreshUI();
        } catch(e) { console.error(e); }
    };
    reader.readAsText(file);
    e.target.value = '';
};

window.handleAudioLoad = (e) => {
    const file = e.target.files[0];
    if(file) {
        state.audioFile = file;
        const audio = document.getElementById('choreoAudio');
        audio.src = URL.createObjectURL(file);
        document.getElementById('audioStatus').textContent = file.name;
        Storage.saveAudioToDB(file);
        state.currentTime = 0;
        UI.updatePlayhead(0);
    }
};

function goToKeyframe(index) {
    state.selectedKeyframeIndex = index;
    const kf = state.choreography[index];
    if(!kf) return;
    document.getElementById('keyframeEditor').style.display = 'block';
    document.getElementById('editTime').value = kf.time.toFixed(2);
    document.getElementById('editSpeed').value = (kf.speed || state.uiMaxSpeed)/1000;
    document.getElementById('editAccel').value = (kf.accel || state.uiAcceleration)/1000;
    for(let i=0; i<4; i++) document.getElementById(`editM${i}`).value = kf.positions[i];
    const z = kf.boxPose ? kf.boxPose.z - PHYSICAL_Z_OFFSET : 0;
    document.getElementById('editBoxZ').value = z;
    document.getElementById('editBoxRoll').value = kf.boxPose?.roll || 0;
    document.getElementById('editBoxPitch').value = kf.boxPose?.pitch || 0;
    window.updateEditorFromBox(true); 
    refreshUI();
}

window.updateEditorFromBox = (skipApply) => {
    const z = document.getElementById('editBoxZ').value;
    const r = document.getElementById('editBoxRoll').value;
    const p = document.getElementById('editBoxPitch').value;
    document.getElementById('dispEditBoxZ').textContent = z;
    document.getElementById('dispEditBoxRoll').textContent = r + '°';
    document.getElementById('dispEditBoxPitch').textContent = p + '°';
    if (!skipApply) {
        const steps = calculateTargetSteps({z: parseInt(z) + PHYSICAL_Z_OFFSET, roll: parseInt(r), pitch: parseInt(p)}, state.homeLengths);
        for(let i=0; i<4; i++) document.getElementById(`editM${i}`).value = steps[i];
        window.saveKeyframeChanges();
    }
};

window.saveKeyframeChanges = () => {
    if (state.selectedKeyframeIndex === -1) return;
    const kf = state.choreography[state.selectedKeyframeIndex];
    if(!kf) return;
    kf.time = parseFloat(document.getElementById('editTime').value);
    kf.speed = parseFloat(document.getElementById('editSpeed').value) * 1000;
    kf.accel = parseFloat(document.getElementById('editAccel').value) * 1000;
    kf.positions = [parseInt(document.getElementById('editM0').value),parseInt(document.getElementById('editM1').value),parseInt(document.getElementById('editM2').value),parseInt(document.getElementById('editM3').value)];
    kf.boxPose = { z: parseInt(document.getElementById('editBoxZ').value) + PHYSICAL_Z_OFFSET, roll: parseInt(document.getElementById('editBoxRoll').value), pitch: parseInt(document.getElementById('editBoxPitch').value) };
    state.choreography.sort((a,b) => a.time - b.time);
    Storage.saveChoreographyToLocal();
    refreshUI();
};

window.closeKeyframeEditor = () => {
    document.getElementById('keyframeEditor').style.display = 'none';
    state.selectedKeyframeIndex = -1;
    refreshUI();
};

window.getCurrentForEditor = () => {
    for(let i=0; i<4; i++) document.getElementById(`editM${i}`).value = state.currentPositions[i];
    window.saveKeyframeChanges();
};

window.updateBoxDisplay = () => {
    const z = document.getElementById('boxZ').value;
    const r = document.getElementById('boxRoll').value;
    const p = document.getElementById('boxPitch').value;
    document.getElementById('valBoxZ').textContent = z;
    document.getElementById('valBoxRoll').textContent = r + '°';
    document.getElementById('valBoxPitch').textContent = p + '°';
};

window.updateBox = () => {
    const z = parseInt(document.getElementById('boxZ').value);
    const r = parseInt(document.getElementById('boxRoll').value);
    const p = parseInt(document.getElementById('boxPitch').value);
    state.boxState = { z: z + PHYSICAL_Z_OFFSET, roll: r, pitch: p };
    const steps = calculateTargetSteps(state.boxState, state.homeLengths);
    state.currentPositions = [...steps];
    const phys = applyMapping(steps);
    Comms.sendCommand(`M ${phys.join(' ')}`);
    for(let i=0; i<4; i++) updatePositionDisplay(i);
    window.updateBoxDisplay();
};

window.resetBox = () => {
    document.getElementById('boxZ').value = 0; document.getElementById('boxRoll').value = 0; document.getElementById('boxPitch').value = 0;
    window.updateBox();
};

window.returnToStart = () => {
    state.currentTime = 0;
    const audio = document.getElementById('choreoAudio');
    if(audio) audio.currentTime = 0;
    UI.updatePlayhead(0);
    
    // Scroll timeline to the left
    const timeline = document.getElementById('timeline');
    if (timeline) timeline.scrollLeft = 0;
};

window.updatePlaybackSpeed = (val) => {
    state.playbackSpeed = parseFloat(val);
    document.getElementById('speedDisplay').textContent = val + 'x';
};

window.updateRestSettings = () => {
    state.restEnabled = document.getElementById('restEnabled').checked;
    state.restDuration = parseFloat(document.getElementById('restDuration').value) || 1;
    localStorage.setItem('restEnabled', state.restEnabled);
    localStorage.setItem('restDuration', state.restDuration);
};

window.updateTimelineDuration = () => {
    state.timelineDuration = parseFloat(document.getElementById('timelineDuration').value) || 0;
    localStorage.setItem('timelineDuration', state.timelineDuration);
    refreshUI();
};

window.clearConsole = () => document.getElementById('console').innerHTML = '';

function loadMapping() {
    const m = localStorage.getItem('motorMapping');
    if(m) {
        state.motorMapping = JSON.parse(m);
    }
    // Always sync dropdowns to state (whether from localStorage or defaults)
    for(let i=0; i<4; i++) {
        const el = document.getElementById(`mapM${i}`);
        if(el) el.value = state.motorMapping[i];
    }
    // Check for duplicate mappings on load
    const uniqueDrivers = new Set(state.motorMapping);
    const warning = document.getElementById('mappingWarning');
    if (warning) {
        warning.style.display = uniqueDrivers.size < 4 ? 'inline' : 'none';
    }
}
function loadReverseFlags() {
    const f = localStorage.getItem('reverseFlags');
    if(f) {
        state.reverseFlags = JSON.parse(f);
        // Sync checkboxes
    }
}

// Drag Handlers
document.addEventListener('mousedown', (e) => {
    if(e.target.classList.contains('playhead')) state.isDraggingPlayhead = true;
});

document.addEventListener('mousemove', (e) => {
    const track = document.querySelector('.timeline-track');
    if(!track) return;
    const rect = track.getBoundingClientRect();
    const PPS = 20;
    if (state.isDraggingPlayhead) {
        let t = (e.clientX - rect.left) / PPS;
        if(t<0) t=0;
        state.currentTime = t;
        const audio = document.getElementById('choreoAudio');
        if(audio && audio.src) audio.currentTime = t;
        UI.updatePlayhead(t);
    }
    if (state.isDraggingKeyframe && state.draggedKeyframeIndex !== -1) {
        let t = (e.clientX - rect.left) / PPS;
        if(t<0) t=0;
        state.choreography[state.draggedKeyframeIndex].time = t;
        UI.updateTimeline(uiCallbacks);
        if(state.selectedKeyframeIndex === state.draggedKeyframeIndex) {
            document.getElementById('editTime').value = t.toFixed(2);
        }
    }
});

document.addEventListener('mouseup', () => {
    state.isDraggingPlayhead = false;
    if(state.isDraggingKeyframe) {
        state.isDraggingKeyframe = false;
        state.choreography.sort((a,b) => a.time - b.time);
        Storage.saveChoreographyToLocal();
        refreshUI();
    }
});

window.updateMapping = () => {
    for(let i=0; i<4; i++) state.motorMapping[i] = parseInt(document.getElementById(`mapM${i}`).value);
    localStorage.setItem('motorMapping', JSON.stringify(state.motorMapping));
    
    // Check for duplicate mappings
    const uniqueDrivers = new Set(state.motorMapping);
    const warning = document.getElementById('mappingWarning');
    if (warning) {
        warning.style.display = uniqueDrivers.size < 4 ? 'inline' : 'none';
    }
    
    for(let i=0; i<4; i++) updatePositionDisplay(i);
};

window.toggleMappingPanel = () => {
    const panel = document.getElementById('mappingPanel');
    if (panel.style.display === 'none') {
        panel.style.display = 'grid';
    } else {
        panel.style.display = 'none';
    }
};

window.updateMicrosteppingOptions = updateMicrosteppingOptions;
window.updateMicrostepping = updateMicrostepping;

window.fetchPorts = async () => {
    try {
        const res = await fetch('/api/ports');
        const ports = await res.json();
        const select = document.getElementById('portSelector');
        if (select) {
            select.innerHTML = '';
            ports.forEach(port => {
                const opt = document.createElement('option');
                opt.value = port.path;
                opt.textContent = port.path + (port.manufacturer ? ` (${port.manufacturer})` : '');
                select.appendChild(opt);
            });
            // Select the last used port if available in localStorage
            const lastPort = localStorage.getItem('lastSerialPort');
            if (lastPort && [...select.options].some(o => o.value === lastPort)) {
                select.value = lastPort;
                // Auto-connect if we have a saved port
                window.connectSerial();
            }
        }
    } catch (e) {
        console.error('Error fetching ports:', e);
    }
};

window.connectSerial = async () => {
    const port = document.getElementById('portSelector').value;
    if (!port) return;
    localStorage.setItem('lastSerialPort', port);
    
    // Disable button temporarily
    const btn = document.getElementById('btnConnect');
    const originalText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port })
        });
        const data = await res.json();
        console.log(data);
    } catch (e) {
        console.error('Error connecting:', e);
    } finally {
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 1000);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.fetchPorts();
    loadMapping();
    loadReverseFlags();
    loadMicrostepping();
    initVirtualBox();
    
    // Load rest settings from localStorage
    const savedRestEnabled = localStorage.getItem('restEnabled');
    const savedRestDuration = localStorage.getItem('restDuration');
    if (savedRestEnabled !== null) state.restEnabled = savedRestEnabled === 'true';
    if (savedRestDuration !== null) state.restDuration = parseFloat(savedRestDuration);
    
    document.getElementById('restEnabled').checked = state.restEnabled;
    document.getElementById('restDuration').value = state.restDuration;
    
    // Load timeline duration from localStorage
    const savedTimelineDuration = localStorage.getItem('timelineDuration');
    if (savedTimelineDuration !== null) state.timelineDuration = parseFloat(savedTimelineDuration);
    document.getElementById('timelineDuration').value = state.timelineDuration;
    
    Comms.setupComms({ onLog: (msg) => {
        const c = document.getElementById('console');
        if(c) { const d = document.createElement('div'); d.textContent = msg; c.appendChild(d); c.scrollTop = c.scrollHeight; }
    }, onStatus: (conn, msg) => {
        const ind = document.getElementById('statusIndicator');
        const txt = document.getElementById('statusText');
        if(conn) { 
            ind.classList.add('connected'); 
            ind.classList.remove('connecting'); 
            txt.textContent = 'Connected to Arduino'; 
        }
        else { 
            ind.classList.remove('connected'); 
            txt.textContent = msg || 'Disconnected'; 
        }
    }, onPositionUpdate: () => {} });
    Comms.connectWebSocket();
    Storage.loadChoreographyFromLocal({ onLoaded: () => refreshUI() });
    Storage.refreshQuickSaveList(updateQuickSaveDropdown);
    Storage.loadAudioFromDB({ onAudioLoaded: (file) => {
        document.getElementById('audioStatus').textContent = file.name;
        const audio = document.getElementById('choreoAudio');
        audio.src = URL.createObjectURL(file);
        state.currentTime = 0;
        UI.updatePlayhead(0);
    }});
    requestAnimationFrame(animateDisplay);
});