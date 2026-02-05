import { VBOX_CONFIG, AXIS_NAMES } from './config.js';
import { state } from './state.js';
import * as Comms from './comms.js';
import * as Storage from './storage.js';
import * as Choreo from './choreography.js';
import * as UI from './ui.js';
import * as Calibration from './calibration.js';
import * as Editor from './editor.js';
import * as Settings from './settings.js';

import {
    getMotorPositions,
    calculateCorners,
    calculateDistance,
    calculateTargetSteps
} from './kinematics.js';

// --- Debug Logging ---
window.debugLog = (...args) => {
    if (state.debugMode) console.log(...args);
};

window.toggleDebug = (enabled) => {
    state.debugMode = enabled;
    console.log(`[Debug] Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
};

// --- Callbacks ---
const choreoCallbacks = {
    onTimeUpdate: (t) => UI.updatePlayhead(t),
    onPositionUpdate: () => {
        for (let i = 0; i < 4; i++) updatePositionDisplay(i);
    },
    onPlayStateChange: (playing) => {
        const btn = document.getElementById('btnPlay');
        if (playing) {
            btn.textContent = 'Pause';
            btn.classList.add('playing');
        } else {
            btn.textContent = 'Play';
            btn.classList.remove('playing');
        }
    },
    onSettingsUpdate: (speed, accel) => {
        if (speed) {
            const val = speed / 1000;
            document.getElementById('speed').value = val;
            document.getElementById('speedSlider').value = val;
        }
        if (accel) {
            const val = accel / 1000;
            document.getElementById('accel').value = val;
            document.getElementById('accelSlider').value = val;
        }
    }
};

const uiCallbacks = {
    onDelete: (index) => {
        state.choreography.splice(index, 1);
        Storage.saveChoreographyToLocal();
        window.refreshUI();
    },
    onSelect: (index) => {
        Editor.goToKeyframe(index);
    },
    onKeyframeDragStart: (index) => {
        state.isDraggingKeyframe = true;
        state.draggedKeyframeIndex = index;
        Editor.goToKeyframe(index);
    }
};

// --- Helper Functions ---
function initVirtualBox() {
    const corners = calculateCorners({ z: -VBOX_CONFIG.maxHeight, roll: 0, pitch: 0 });
    const motors = getMotorPositions();
    for (let i = 0; i < 4; i++) {
        state.homeLengths[i] = calculateDistance(motors[i], corners[i]);
    }
}
window.initVirtualBox = initVirtualBox;

function applyMapping(logicalSteps) {
    const physicalSteps = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
        const driverIndex = state.motorMapping[i];
        let s = logicalSteps[i];
        // if (state.reverseFlags[i]) s = -s; // Removed software inversion
        physicalSteps[driverIndex] = s;
    }
    return physicalSteps;
}

// --- Animation Loop ---
let lastFrameTime = null;

function animateDisplay(timestamp) {
    if (!lastFrameTime) lastFrameTime = timestamp;
    const dt = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    // Update Rest Countdown
    const restEl = document.getElementById('restCountdown');
    if (restEl) {
        if (state.isResting && state.restStartTime) {
            const elapsed = Date.now() - state.restStartTime;
            const remaining = Math.max(0, state.restTotalDuration - elapsed);
            const seconds = Math.ceil(remaining / 1000);
            restEl.textContent = `Resting: ${seconds}s`;
            restEl.style.display = 'inline-block';
        } else {
            restEl.style.display = 'none';
        }
    }

    if (state.isPlaying) {
        const now = Date.now();
        const expectedTime = ((now - state.playbackStartTime) / 1000) * state.playbackSpeed;
        state.currentTime = expectedTime;
        choreoCallbacks.onTimeUpdate(state.currentTime);
    }

    const isSmooth = document.getElementById('smoothAnimation')?.checked;

    if (!isSmooth) {
        for (let i = 0; i < 4; i++) state.visualPositions[i] = state.currentPositions[i];
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

    if (changed) for (let i = 0; i < 4; i++) updatePositionDisplay(i);
    requestAnimationFrame(animateDisplay);
}

function updatePositionDisplay(motorIndex) {
    const physicalAxisIndex = state.motorMapping[motorIndex];
    const displayId = `pos${AXIS_NAMES[physicalAxisIndex]}`;
    let displayValue = Math.round(state.visualPositions[motorIndex]);
    const displayEl = document.getElementById(displayId);
    if (displayEl) displayEl.textContent = displayValue;

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
    const physRel = [0, 0, 0, 0];
    let relSteps = steps;
    // if (state.reverseFlags[axisIndex]) relSteps = -relSteps; // Removed software inversion
    physRel[state.motorMapping[axisIndex]] = relSteps;
    Comms.sendCommand(`R ${physRel.join(' ')}`);
    updatePositionDisplay(axisIndex);
};

window.moveToSlider = (axisName, axisIndex, value) => {
    let target = parseInt(value);
    const phys = state.motorMapping[axisIndex];
    state.currentPositions[axisIndex] = target;
    const physicalSteps = applyMapping(state.currentPositions);
    Comms.sendCommand(`M ${physicalSteps.join(' ')}`);
    updatePositionDisplay(axisIndex);
};

window.moveAllMotors = (dist) => {
    const steps = Math.round(dist * VBOX_CONFIG.stepsPerMm);
    for (let i = 0; i < 4; i++) state.currentPositions[i] += steps;
    const physRel = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
        let s = steps;
        // if (state.reverseFlags[i]) s = -s; // Removed software inversion
        physRel[state.motorMapping[i]] = s;
    }
    Comms.sendCommand(`R ${physRel.join(' ')}`);
    for (let i = 0; i < 4; i++) updatePositionDisplay(i);
};

window.moveAllToZero = () => {
    state.currentPositions = [0, 0, 0, 0];
    Comms.sendCommand(`M 0 0 0 0`);
    for (let i = 0; i < 4; i++) updatePositionDisplay(i);
};

window.toggleReverse = (logicalIndex, checked) => {
    state.reverseFlags[logicalIndex] = checked;
    const physicalIndex = state.motorMapping[logicalIndex];
    Comms.sendCommand(`V ${physicalIndex} ${checked ? 1 : 0}`);
};

window.toggleMotors = (checked) => {
    const toggle = document.getElementById('motorToggle');
    if (toggle && toggle._updatingFromArduino) return;
    
    state.isTogglingMotors = true;

    if (checked) {
        Comms.sendCommand('E 1');
        setTimeout(() => { state.isTogglingMotors = false; }, 1000);
    } else {
        window.haltMotors();
        setTimeout(() => {
            Comms.sendCommand('E 0');
            window.setFloor();
            state.isTogglingMotors = false;
        }, 500);
    }
};

window.setFloor = () => {
    Comms.sendCommand('H');
    state.currentPositions = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) updatePositionDisplay(i);
    document.getElementById('boxZ').value = 0;
    document.getElementById('boxRoll').value = 0;
    document.getElementById('boxPitch').value = 0;
    window.updateBoxDisplay();
    initVirtualBox();
};

window.setCeiling = () => {
    const maxSteps = Math.max(...state.currentPositions);
    state.maxCeiling = Math.round(Math.max(100, maxSteps / VBOX_CONFIG.stepsPerMm));
    localStorage.setItem('maxCeiling', state.maxCeiling);
    document.getElementById('boxZ').max = state.maxCeiling;
    document.getElementById('editBoxZ').max = state.maxCeiling;
    const manualIn = document.getElementById('manualCeiling');
    if (manualIn) manualIn.value = state.maxCeiling;
    for (let i = 0; i < 4; i++) updatePositionDisplay(i);
};

window.updateCeilingFromInput = () => {
    const val = parseInt(document.getElementById('manualCeiling').value);
    if (!isNaN(val) && val > 0) {
        state.maxCeiling = val;
        localStorage.setItem('maxCeiling', state.maxCeiling);
        document.getElementById('boxZ').max = state.maxCeiling;
        document.getElementById('editBoxZ').max = state.maxCeiling;
        for (let i = 0; i < 4; i++) updatePositionDisplay(i);
    }
};

window.haltMotors = () => {
    Comms.sendCommand('Q');
    if (state.isPlaying) Choreo.stopChoreography(choreoCallbacks);
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
    if (fromSlider) i.value = s.value; else s.value = i.value;
};

window.updateAccelUI = (fromSlider) => {
    const s = document.getElementById('accelSlider');
    const i = document.getElementById('accel');
    if (fromSlider) i.value = s.value; else s.value = i.value;
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
    state.choreography.sort((a, b) => a.time - b.time);
    Storage.saveChoreographyToLocal();
    window.refreshUI();
};

window.playChoreography = () => Choreo.playChoreography(choreoCallbacks);
window.stopChoreography = () => {
    Choreo.stopChoreography(choreoCallbacks);
    state.currentTime = 0;
    UI.updatePlayhead(0);
};
window.togglePlayback = () => {
    Choreo.playChoreography(choreoCallbacks);
};
window.clearChoreography = () => {
    state.choreography = [];
    Storage.saveChoreographyToLocal();
    window.refreshUI();
};

window.quickSave = () => {
    if (Storage.quickSave()) Storage.refreshQuickSaveList(updateQuickSaveDropdown);
};
window.quickLoad = () => {
    const name = document.getElementById('quickSaveSelect').value;
    if (Storage.quickLoad(name, { onLoaded: window.refreshUI })) window.refreshUI();
};
window.quickDelete = () => {
    const name = document.getElementById('quickSaveSelect').value;
    if (confirm(`Delete ${name}?`)) {
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
    if (name) {
        state.currentFileName = name;
        Storage.saveChoreographyToLocal();
        const data = localStorage.getItem('choreographyData');
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${name}.json`; a.click();
        window.closeSaveDialog();
    }
};
window.loadChoreography = () => document.getElementById('fileInput').click();
window.handleFileLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            state.choreography = data.choreography || [];
            state.currentFileName = file.name.replace('.json', '');
            Storage.saveChoreographyToLocal();
            window.refreshUI();
            Comms.sendChoreographyUpdate();
        } catch (e) { console.error(e); }
    };
    reader.readAsText(file);
    e.target.value = '';
};

window.handleAudioLoad = async (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('audioStatus').textContent = 'Uploading...';
        const formData = new FormData();
        formData.append('audio', file);
        try {
            const response = await fetch('/api/audio/upload', { method: 'POST', body: formData });
            const responseText = await response.text();
            if (response.ok) {
                const result = JSON.parse(responseText);
                document.getElementById('audioStatus').textContent = result.fileName + ' (Pi)';
                state.serverAudioLoaded = true;
                state.currentTime = 0;
                UI.updatePlayhead(0);
            } else {
                document.getElementById('audioStatus').textContent = 'Upload failed';
            }
        } catch (err) {
            document.getElementById('audioStatus').textContent = 'Upload error';
        }
    }
    e.target.value = '';
};

window.updateBoxFromInput = (axis) => {
    const inputId = axis === 'roll' ? 'valBoxRollInput' : 'valBoxPitchInput';
    const sliderId = axis === 'roll' ? 'boxRoll' : 'boxPitch';
    const val = parseInt(document.getElementById(inputId).value);
    if (!isNaN(val)) {
        document.getElementById(sliderId).value = val;
        window.updateBox();
    }
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
    try {
        const z = parseInt(document.getElementById('boxZ').value);
        const r = parseInt(document.getElementById('boxRoll').value);
        const p = parseInt(document.getElementById('boxPitch').value);
        state.boxState = { z: z - VBOX_CONFIG.maxHeight, roll: r, pitch: p };

        if (!state.homeLengths || state.homeLengths.length !== 4 || isNaN(state.homeLengths[0])) {
            initVirtualBox();
        }

        const steps = calculateTargetSteps(state.boxState, state.homeLengths);
        if (steps.some(isNaN)) throw new Error("Calculated steps contain NaN. Check Config.");

        state.currentPositions = [...steps];
        const phys = applyMapping(steps);

        const c = document.getElementById('console');
        if (c) {
            const d = document.createElement('div');
            d.textContent = `Cmd: M ${phys.join(' ')}`;
            c.appendChild(d);
            c.scrollTop = c.scrollHeight;
        }

        Comms.sendCommand(`M ${phys.join(' ')}`);
        for (let i = 0; i < 4; i++) updatePositionDisplay(i);
        window.updateBoxDisplay();

    } catch (e) {
        console.error(e);
        const c = document.getElementById('console');
        if (c) {
            const d = document.createElement('div');
            d.textContent = "Error: " + e.message;
            d.style.color = "red";
            c.appendChild(d);
            c.scrollTop = c.scrollHeight;
        }
    }
};

window.resetBox = () => {
    document.getElementById('boxZ').value = 0; document.getElementById('boxRoll').value = 0; document.getElementById('boxPitch').value = 0;
    window.updateBox();
};

window.resetBoxRoll = () => {
    document.getElementById('boxRoll').value = 0;
    window.updateBox();
};

window.resetBoxPitch = () => {
    document.getElementById('boxPitch').value = 0;
    window.updateBox();
};

window.updateFrameDimensions = () => {
    const w = parseFloat(document.getElementById('frameWidth').value);
    const l = parseFloat(document.getElementById('frameLength').value);
    const h = parseFloat(document.getElementById('frameHeight').value);

    if (!isNaN(w) && w > 0) VBOX_CONFIG.frameWidth = w;
    if (!isNaN(l) && l > 0) VBOX_CONFIG.frameLength = l;
    if (!isNaN(h) && h > 0) VBOX_CONFIG.maxHeight = h;

    localStorage.setItem('frameWidth', VBOX_CONFIG.frameWidth);
    localStorage.setItem('frameLength', VBOX_CONFIG.frameLength);
    localStorage.setItem('frameHeight', VBOX_CONFIG.maxHeight);

    document.getElementById('boxZ').max = VBOX_CONFIG.maxHeight;
    document.getElementById('editBoxZ').max = VBOX_CONFIG.maxHeight;

    initVirtualBox();
    Comms.sendChoreographyUpdate();
};

function loadFrameDimensions() {
    const w = localStorage.getItem('frameWidth');
    const l = localStorage.getItem('frameLength');
    const h = localStorage.getItem('frameHeight');

    if (w) VBOX_CONFIG.frameWidth = parseFloat(w);
    if (l) VBOX_CONFIG.frameLength = parseFloat(l);
    if (h) VBOX_CONFIG.maxHeight = parseFloat(h);

    document.getElementById('frameWidth').value = VBOX_CONFIG.frameWidth;
    document.getElementById('frameLength').value = VBOX_CONFIG.frameLength;

    const fh = document.getElementById('frameHeight');
    if (fh) fh.value = VBOX_CONFIG.maxHeight;

    document.getElementById('boxZ').max = VBOX_CONFIG.maxHeight;
    document.getElementById('editBoxZ').max = VBOX_CONFIG.maxHeight;
}

window.returnToStart = () => {
    state.currentTime = 0;
    const audio = document.getElementById('choreoAudio');
    if (audio) audio.currentTime = 0;
    UI.updatePlayhead(0);
    const timeline = document.getElementById('timeline');
    if (timeline) timeline.scrollLeft = 0;
};

window.updatePlaybackSpeed = (val) => {
    state.playbackSpeed = parseFloat(val);
    document.getElementById('speedDisplay').textContent = val + 'x';
};

window.updateVolume = (val) => {
    const volume = parseInt(val);
    document.getElementById('volumeDisplay').textContent = volume + '%';
    localStorage.setItem('audioVolume', volume);
    Comms.sendAudioCommand('setVolume', { volume });
};

window.updateRestSettings = () => {
    state.restEnabled = document.getElementById('restEnabled').checked;
    state.restDuration = parseFloat(document.getElementById('restDuration').value) || 1;
    localStorage.setItem('restEnabled', state.restEnabled);
    localStorage.setItem('restDuration', state.restDuration);
    Comms.sendChoreographyUpdate();
};

window.updateLoopSettings = () => {
    state.loopEnabled = document.getElementById('loopChoreography').checked;
    localStorage.setItem('loopEnabled', state.loopEnabled);
    Comms.sendChoreographyUpdate();
};

window.updateTimelineDuration = () => {
    state.timelineDuration = parseFloat(document.getElementById('timelineDuration').value) || 0;
    localStorage.setItem('timelineDuration', state.timelineDuration);
    window.refreshUI();
};

window.updateTimelineZoom = (value) => {
    const timeline = document.getElementById('timeline');
    const oldZoom = state.timelineZoom || 20;
    const newZoom = parseInt(value) || 20;
    const playheadPixelPos = state.currentTime * oldZoom;
    const scrollLeft = timeline.scrollLeft;
    const viewportOffset = playheadPixelPos - scrollLeft;

    state.timelineZoom = newZoom;
    document.getElementById('zoomDisplay').textContent = state.timelineZoom + ' px/s';
    localStorage.setItem('timelineZoom', state.timelineZoom);
    window.refreshUI();

    const newPlayheadPixelPos = state.currentTime * newZoom;
    timeline.scrollLeft = newPlayheadPixelPos - viewportOffset;
};

window.clearConsole = () => document.getElementById('console').innerHTML = '';

function loadMapping() {
    const m = localStorage.getItem('motorMapping');
    if (m) state.motorMapping = JSON.parse(m);
    else state.motorMapping = [...state.motorMapping];
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById(`mapM${i}`);
        if (el) el.value = state.motorMapping[i];
    }
    const uniqueDrivers = new Set(state.motorMapping);
    const warning = document.getElementById('mappingWarning');
    if (warning) warning.style.display = uniqueDrivers.size < 4 ? 'inline' : 'none';
}
function loadReverseFlags() {
    const f = localStorage.getItem('reverseFlags');
    if (f) {
        try {
            const flags = JSON.parse(f);
            state.reverseFlags = flags.map(x => !!x);
            const reverseIds = ['reverseX', 'reverseY', 'reverseZ', 'reverseA'];
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(reverseIds[i]);
                if (el) el.checked = state.reverseFlags[i];
            }
        } catch (e) { console.error("Error loading reverse flags:", e); }
    }
}

// Drag Handlers
document.addEventListener('mousedown', (e) => {
    const timeline = document.getElementById('timeline');
    const track = document.querySelector('.timeline-track');
    if (timeline && track) {
        const timelineRect = timeline.getBoundingClientRect();
        const isInTimeline = e.clientX >= timelineRect.left && e.clientX <= timelineRect.right &&
            e.clientY >= timelineRect.top && e.clientY <= timelineRect.bottom;

        if (isInTimeline && !e.target.classList.contains('keyframe-marker')) {
            e.preventDefault();
            state.isDraggingPlayhead = true;
            const rect = track.getBoundingClientRect();
            const PPS = state.timelineZoom || 20;
            let t = (e.clientX - rect.left) / PPS;
            if (t < 0) t = 0;
            state.currentTime = t;
            UI.updatePlayhead(t);
        }
    }
});

document.addEventListener('mousemove', (e) => {
    const track = document.querySelector('.timeline-track');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const PPS = state.timelineZoom || 20;
    if (state.isDraggingPlayhead) {
        let t = (e.clientX - rect.left) / PPS;
        if (t < 0) t = 0;
        state.currentTime = t;
        const audio = document.getElementById('choreoAudio');
        if (audio && audio.src) audio.currentTime = t;
        UI.updatePlayhead(t);
    }
    if (state.isDraggingKeyframe && state.draggedKeyframeIndex !== -1) {
        let t = (e.clientX - rect.left) / PPS;
        if (t < 0) t = 0;
        state.choreography[state.draggedKeyframeIndex].time = t;
        UI.updateTimeline(uiCallbacks);
        if (state.selectedKeyframeIndex === state.draggedKeyframeIndex) {
            document.getElementById('editTime').value = t.toFixed(2);
        }
    }
});

document.addEventListener('mouseup', () => {
    if (state.isDraggingPlayhead) {
        state.isDraggingPlayhead = false;
        if (state.isPlaying) {
            Comms.sendPlayChoreography(state.currentTime, state.playbackSpeed);
        } else if (state.serverAudioLoaded) {
            Comms.seekServerAudio(state.currentTime);
        }
    }
    if (state.isDraggingKeyframe) {
        state.isDraggingKeyframe = false;
        state.choreography.sort((a, b) => a.time - b.time);
        Storage.saveChoreographyToLocal();
        window.refreshUI();
    }
});

window.updateMapping = () => {
    for (let i = 0; i < 4; i++) state.motorMapping[i] = parseInt(document.getElementById(`mapM${i}`).value);
    localStorage.setItem('motorMapping', JSON.stringify(state.motorMapping));
    Comms.sendChoreographyUpdate();
    const uniqueDrivers = new Set(state.motorMapping);
    const warning = document.getElementById('mappingWarning');
    if (warning) warning.style.display = uniqueDrivers.size < 4 ? 'inline' : 'none';
    for (let i = 0; i < 4; i++) updatePositionDisplay(i);
};

window.toggleMappingPanel = () => {
    const panel = document.getElementById('mappingPanel');
    const btn = document.getElementById('btnToggleMapping');
    if (panel.style.display === 'none') {
        panel.style.display = 'grid';
        if (btn) btn.textContent = '▲';
    } else {
        panel.style.display = 'none';
        if (btn) btn.textContent = '▼';
    }
};

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
            const lastPort = localStorage.getItem('lastSerialPort');
            if (lastPort && [...select.options].some(o => o.value === lastPort)) {
                select.value = lastPort;
                window.connectSerial();
            }
        }
    } catch (e) { console.error('Error fetching ports:', e); }
};

window.connectSerial = async () => {
    const port = document.getElementById('portSelector').value;
    if (!port) return;
    localStorage.setItem('lastSerialPort', port);
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
    } catch (e) { console.error('Error connecting:', e); } finally {
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 1000);
    }
};

window.syncHardware = () => {
    console.log("Syncing Hardware... Waiting 2s for boot...");
    setTimeout(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        Comms.sendCommand(`S ${state.uiMaxSpeed}`);
        await wait(100);
        Comms.sendCommand(`A ${state.uiAcceleration}`);
        console.log("Hardware Synced (Speed/Accel only)");
    }, 2000);
};

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

document.addEventListener('DOMContentLoaded', () => {
    Editor.setupEditorShortcuts();
    window.fetchPorts();
    loadMapping();
    loadReverseFlags();
    Settings.loadMicrostepping();
    loadFrameDimensions();
    initVirtualBox();

    const savedCeiling = localStorage.getItem('maxCeiling');
    if (savedCeiling) {
        state.maxCeiling = Math.round(parseFloat(savedCeiling));
        const boxZ = document.getElementById('boxZ');
        if (boxZ) boxZ.max = state.maxCeiling;
        const editBoxZ = document.getElementById('editBoxZ');
        if (editBoxZ) editBoxZ.max = state.maxCeiling;
        const manualIn = document.getElementById('manualCeiling');
        if (manualIn) manualIn.value = state.maxCeiling;
    }

    const savedRestEnabled = localStorage.getItem('restEnabled');
    const savedRestDuration = localStorage.getItem('restDuration');
    if (savedRestEnabled !== null) state.restEnabled = savedRestEnabled === 'true';
    if (savedRestDuration !== null) state.restDuration = parseFloat(savedRestDuration);
    document.getElementById('restEnabled').checked = state.restEnabled;
    document.getElementById('restDuration').value = state.restDuration;

    const savedTimelineDuration = localStorage.getItem('timelineDuration');
    if (savedTimelineDuration !== null) state.timelineDuration = parseFloat(savedTimelineDuration);
    const elTimelineDuration = document.getElementById('timelineDuration');
    if (elTimelineDuration) elTimelineDuration.value = state.timelineDuration;

    const savedTimelineZoom = localStorage.getItem('timelineZoom');
    if (savedTimelineZoom !== null) state.timelineZoom = parseInt(savedTimelineZoom);
    document.getElementById('timelineZoom').value = state.timelineZoom;
    document.getElementById('zoomDisplay').textContent = state.timelineZoom + ' px/s';

    const savedVolume = localStorage.getItem('audioVolume');
    if (savedVolume !== null) {
        const vol = parseInt(savedVolume);
        document.getElementById('volumeSlider').value = vol;
        document.getElementById('volumeDisplay').textContent = vol + '%';
    }

    Comms.setupComms({
        onLog: (msg) => {
            const c = document.getElementById('console');
            if (c) { const d = document.createElement('div'); d.textContent = msg; c.appendChild(d); c.scrollTop = c.scrollHeight; }
        }, onStatus: (conn, msg) => {
            const ind = document.getElementById('statusIndicator');
            const txt = document.getElementById('statusText');
            if (conn) {
                ind.classList.add('connected');
                ind.classList.remove('connecting');
                txt.textContent = 'Connected to Arduino';
            }
            else {
                ind.classList.remove('connected');
                txt.textContent = msg || 'Disconnected';
            }
        }, onPositionUpdate: () => { },
        onAudioStateUpdate: (audioState) => {
            if (audioState.fileName) document.getElementById('audioStatus').textContent = audioState.fileName + ' (Pi)';
            if (audioState.isPlaying) state.serverAudioTime = audioState.currentTime;
        },
        onPlayStateUpdate: (data) => {
            state.isPlaying = data.isPlaying;
            state.playbackSpeed = data.speed;
            if (data.currentTime !== undefined) {
                state.currentTime = data.currentTime;
                state.playbackStartTime = Date.now() - (data.currentTime * 1000 / state.playbackSpeed);
                choreoCallbacks.onTimeUpdate(state.currentTime);

                // Auto-scroll to start on Loop/Reset
                if (data.currentTime === 0) {
                    const timeline = document.getElementById('timeline');
                    if (timeline) timeline.scrollLeft = 0;
                }
            }
            choreoCallbacks.onPlayStateChange(state.isPlaying);
        },
        onChoreographySync: (data) => {
            debugLog('[App] Choreography sync received:', data.fileName);
            state.choreography = data.choreography || [];
            state.currentFileName = data.fileName || 'Untitled';
            if (data.reverseFlags) state.reverseFlags = data.reverseFlags;
            
            if (data.loopEnabled !== undefined) {
                state.loopEnabled = data.loopEnabled;
                const elLoop = document.getElementById('loopChoreography');
                if (elLoop) elLoop.checked = state.loopEnabled;
            }

            if (data.restEnabled !== undefined) {
                state.restEnabled = data.restEnabled;
                const elRest = document.getElementById('restEnabled');
                if (elRest) elRest.checked = state.restEnabled;
            }

            if (data.restDuration !== undefined) {
                state.restDuration = data.restDuration;
                const elRestDur = document.getElementById('restDuration');
                if (elRestDur) elRestDur.value = state.restDuration;
            }

            if (data.frameDimensions) {
                const fd = data.frameDimensions;
                if (fd.width) VBOX_CONFIG.frameWidth = fd.width;
                if (fd.length) VBOX_CONFIG.frameLength = fd.length;
                if (fd.height) VBOX_CONFIG.maxHeight = fd.height;
                
                const elW = document.getElementById('frameWidth');
                const elL = document.getElementById('frameLength');
                const elH = document.getElementById('frameHeight');
                if (elW) elW.value = VBOX_CONFIG.frameWidth;
                if (elL) elL.value = VBOX_CONFIG.frameLength;
                if (elH) elH.value = VBOX_CONFIG.maxHeight;
                
                initVirtualBox();
            }

            if (data.settings) {
                state.uiMaxSpeed = data.settings.speed || state.uiMaxSpeed;
                state.uiAcceleration = data.settings.accel || state.uiAcceleration;
                document.getElementById('speed').value = state.uiMaxSpeed / 1000;
                document.getElementById('speedSlider').value = state.uiMaxSpeed / 1000;
                document.getElementById('accel').value = state.uiAcceleration / 1000;
                document.getElementById('accelSlider').value = state.uiAcceleration / 1000;
            }
            for (let i = 0; i < 4; i++) {
                const checkbox = document.getElementById(`reverse${['X', 'Y', 'A', 'Z'][i]}`);
                if (checkbox) checkbox.checked = state.reverseFlags[i];
            }
            window.refreshUI();
        }
    });
    Comms.connectWebSocket();
    Storage.loadChoreographyFromLocal({ onLoaded: () => window.refreshUI() });
    Storage.refreshQuickSaveList(updateQuickSaveDropdown);
    Storage.loadAudioFromDB({
        onAudioLoaded: (file) => {
            if (!state.serverAudioLoaded) {
                document.getElementById('audioStatus').textContent = file.name + ' (local)';
                const audio = document.getElementById('choreoAudio');
                audio.src = URL.createObjectURL(file);
                state.currentTime = 0;
                UI.updatePlayhead(0);
            }
        }
    });
    requestAnimationFrame(animateDisplay);
});
