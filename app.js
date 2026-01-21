import {
    VBOX_CONFIG,
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

// --- Debug Logging ---
window.debugLog = (...args) => {
    if (state.debugMode) {
        console.log(...args);
    }
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
    const corners = calculateCorners({ z: -VBOX_CONFIG.maxHeight, roll: 0, pitch: 0 });
    const motors = getMotorPositions();
    for (let i = 0; i < 4; i++) {
        state.homeLengths[i] = calculateDistance(motors[i], corners[i]);
    }
}


function applyMapping(logicalSteps) {
    const physicalSteps = [0, 0, 0, 0];
    const debugMap = [];
    for (let i = 0; i < 4; i++) {
        const driverIndex = state.motorMapping[i];
        let s = logicalSteps[i];
        if (state.reverseFlags[i]) s = -s;
        physicalSteps[driverIndex] = s;
        debugMap.push(`M${i}->Dr${driverIndex} (Rev:${state.reverseFlags[i]}): ${logicalSteps[i]}->${s}`);
    }
    console.log("Mapping:", debugMap.join(', '));
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
let lastFrameTime = null;

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
    if (state.reverseFlags[axisIndex]) relSteps = -relSteps;
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
        if (state.reverseFlags[i]) s = -s;
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
    localStorage.setItem('reverseFlags', JSON.stringify(state.reverseFlags));
    // Software inversion only. No Hardware command sent.
};

window.toggleMotors = (checked) => {
    const toggle = document.getElementById('motorToggle');
    // Skip if this was triggered by Arduino status update
    if (toggle && toggle._updatingFromArduino) return;

    if (checked) {
        Comms.sendCommand('E 1');
    } else {
        window.haltMotors(); // Stop gracefully first
        setTimeout(() => {
            Comms.sendCommand('E 0');
            window.setFloor(); // Reset positions after disable
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
    refreshUI();
};

window.playChoreography = () => Choreo.playChoreography(choreoCallbacks);
window.stopChoreography = () => {
    Choreo.stopChoreography(choreoCallbacks);
    // Reset to beginning
    state.currentTime = 0;
    UI.updatePlayhead(0);
};
window.togglePlayback = () => {
    if (state.isPlaying) {
        Choreo.stopChoreography(choreoCallbacks);
    } else {
        Choreo.playChoreography(choreoCallbacks);
    }
};
window.clearChoreography = () => {
    state.choreography = [];
    Storage.saveChoreographyToLocal();
    refreshUI();
};

window.quickSave = () => {
    if (Storage.quickSave()) {
        Storage.refreshQuickSaveList(updateQuickSaveDropdown);
    }
};
window.quickLoad = () => {
    const name = document.getElementById('quickSaveSelect').value;
    if (Storage.quickLoad(name, { onLoaded: refreshUI })) {
        refreshUI();
    }
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
            refreshUI();
        } catch (e) { console.error(e); }
    };
    reader.readAsText(file);
    e.target.value = '';
};

window.saveConfig = () => {
    const config = {
        motorMapping: state.motorMapping,
        reverseFlags: state.reverseFlags,
        frameWidth: VBOX_CONFIG.frameWidth,
        frameLength: VBOX_CONFIG.frameLength,
        maxHeight: VBOX_CONFIG.maxHeight,
        driverType: localStorage.getItem('driverType') || 'A4988',
        microsteps: VBOX_CONFIG.microsteps,
        uiMaxSpeed: state.uiMaxSpeed,
        uiAcceleration: state.uiAcceleration,
        restEnabled: state.restEnabled,
        restDuration: state.restDuration,
        timelineDuration: state.timelineDuration,
        maxCeiling: state.maxCeiling
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rts-config.json';
    a.click();
};

window.loadConfig = () => {
    document.getElementById('configFileInput').click();
};

window.handleConfigLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const config = JSON.parse(evt.target.result);

            // Apply Settings
            if (config.motorMapping) {
                state.motorMapping = config.motorMapping;
                localStorage.setItem('motorMapping', JSON.stringify(state.motorMapping));
            }
            if (config.reverseFlags) {
                state.reverseFlags = config.reverseFlags;
                localStorage.setItem('reverseFlags', JSON.stringify(state.reverseFlags));
            }

            // Frame
            if (config.frameWidth) VBOX_CONFIG.frameWidth = parseFloat(config.frameWidth);
            if (config.frameLength) VBOX_CONFIG.frameLength = parseFloat(config.frameLength);
            if (config.maxHeight) VBOX_CONFIG.maxHeight = parseFloat(config.maxHeight);

            localStorage.setItem('frameWidth', VBOX_CONFIG.frameWidth);
            localStorage.setItem('frameLength', VBOX_CONFIG.frameLength);
            localStorage.setItem('frameHeight', VBOX_CONFIG.maxHeight);

            // Driver & Microsteps
            if (config.driverType) localStorage.setItem('driverType', config.driverType);
            if (config.microsteps) {
                VBOX_CONFIG.microsteps = parseInt(config.microsteps);
                localStorage.setItem('microsteps', VBOX_CONFIG.microsteps);
            }

            // Speed & Accel
            if (config.uiMaxSpeed) {
                state.uiMaxSpeed = config.uiMaxSpeed;
                const val = state.uiMaxSpeed / 1000;
                document.getElementById('speed').value = val;
                document.getElementById('speedSlider').value = val;
                Comms.sendCommand(`S ${state.uiMaxSpeed}`);
            }
            if (config.uiAcceleration) {
                state.uiAcceleration = config.uiAcceleration;
                const val = state.uiAcceleration / 1000;
                document.getElementById('accel').value = val;
                document.getElementById('accelSlider').value = val;
                Comms.sendCommand(`A ${state.uiAcceleration}`);
            }

            // Rest
            if (config.restEnabled !== undefined) state.restEnabled = config.restEnabled;
            if (config.restDuration !== undefined) state.restDuration = parseFloat(config.restDuration);
            localStorage.setItem('restEnabled', state.restEnabled);
            localStorage.setItem('restDuration', state.restDuration);

            // Timeline
            if (config.timelineDuration !== undefined) state.timelineDuration = parseFloat(config.timelineDuration);
            localStorage.setItem('timelineDuration', state.timelineDuration);

            // Ceiling
            if (config.maxCeiling !== undefined) {
                state.maxCeiling = parseFloat(config.maxCeiling);
                localStorage.setItem('maxCeiling', state.maxCeiling);
            }

            // Smooth
            if (config.smoothAnimation !== undefined) {
                const el = document.getElementById('smoothAnimation');
                if (el) el.checked = config.smoothAnimation;
            }

            // --- REFRESH UI ---
            // Mapping UI
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(`mapM${i}`);
                if (el) el.value = state.motorMapping[i];
            }
            const uniqueDrivers = new Set(state.motorMapping);
            const warning = document.getElementById('mappingWarning');
            if (warning) warning.style.display = uniqueDrivers.size < 4 ? 'inline' : 'none';

            // Reverse Flags UI
            const reverseIds = ['reverseX', 'reverseY', 'reverseZ', 'reverseA'];
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(reverseIds[i]);
                if (el) el.checked = state.reverseFlags[i];
            }

            // Frame UI
            document.getElementById('frameWidth').value = VBOX_CONFIG.frameWidth;
            document.getElementById('frameLength').value = VBOX_CONFIG.frameLength;
            document.getElementById('frameHeight').value = VBOX_CONFIG.maxHeight;

            // Update Slider Max
            document.getElementById('boxZ').max = VBOX_CONFIG.maxHeight;
            document.getElementById('editBoxZ').max = VBOX_CONFIG.maxHeight;

            // Driver & Microsteps UI
            const driverSelect = document.getElementById('driverType');
            if (driverSelect && config.driverType) driverSelect.value = config.driverType;

            window.updateMicrosteppingOptions();

            // Rest UI
            document.getElementById('restEnabled').checked = state.restEnabled;
            document.getElementById('restDuration').value = state.restDuration;

            // Timeline UI
            document.getElementById('timelineDuration').value = state.timelineDuration;

            // Recalc
            initVirtualBox();
            refreshUI();

            alert("Config loaded successfully");

        } catch (e) { console.error('Error loading config:', e); alert('Invalid config file'); }
    };
    reader.readAsText(file);
    e.target.value = '';
};

window.handleAudioLoad = async (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('audioStatus').textContent = 'Uploading...';

        // Upload to server for Pi-side playback
        const formData = new FormData();
        formData.append('audio', file);

        try {
            const response = await fetch('/api/audio/upload', {
                method: 'POST',
                body: formData
            });

            // Read the response body once
            const responseText = await response.text();

            if (response.ok) {
                try {
                    const result = JSON.parse(responseText);
                    document.getElementById('audioStatus').textContent = result.fileName + ' (Pi)';
                    state.serverAudioLoaded = true;
                    state.currentTime = 0;
                    UI.updatePlayhead(0);
                    console.log('Audio uploaded to server:', result.fileName);
                } catch {
                    console.error('Invalid JSON response:', responseText);
                    document.getElementById('audioStatus').textContent = 'Upload error';
                }
            } else {
                let errMsg = `HTTP ${response.status}`;
                try {
                    const err = JSON.parse(responseText);
                    errMsg = err.error || errMsg;
                } catch {
                    errMsg = responseText || errMsg;
                }
                document.getElementById('audioStatus').textContent = 'Upload failed';
                console.error('Audio upload failed:', errMsg);
            }
        } catch (err) {
            document.getElementById('audioStatus').textContent = 'Upload error';
            console.error('Audio upload error:', err);
        }
    }
    e.target.value = '';
};

function goToKeyframe(index) {
    state.selectedKeyframeIndex = index;
    const kf = state.choreography[index];
    if (!kf) return;
    document.getElementById('keyframeEditor').style.display = 'block';
    document.getElementById('editTime').value = kf.time.toFixed(2);
    const speedVal = (kf.speed || state.uiMaxSpeed) / 1000;
    const accelVal = (kf.accel || state.uiAcceleration) / 1000;
    document.getElementById('editSpeed').value = speedVal;
    document.getElementById('editSpeedSlider').value = speedVal;
    document.getElementById('editAccel').value = accelVal;
    document.getElementById('editAccelSlider').value = accelVal;
    for (let i = 0; i < 4; i++) document.getElementById(`editM${i}`).value = kf.positions[i];
    const z = kf.boxPose ? kf.boxPose.z + VBOX_CONFIG.maxHeight : 0;
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
        const steps = calculateTargetSteps({ z: parseInt(z) - VBOX_CONFIG.maxHeight, roll: parseInt(r), pitch: parseInt(p) }, state.homeLengths);
        for (let i = 0; i < 4; i++) document.getElementById(`editM${i}`).value = steps[i];
        window.saveKeyframeChanges();
    }
};

window.saveKeyframeChanges = () => {
    if (state.selectedKeyframeIndex === -1) return;
    const kf = state.choreography[state.selectedKeyframeIndex];
    if (!kf) return;
    kf.time = parseFloat(document.getElementById('editTime').value);
    kf.speed = parseFloat(document.getElementById('editSpeed').value) * 1000;
    kf.accel = parseFloat(document.getElementById('editAccel').value) * 1000;
    kf.positions = [parseInt(document.getElementById('editM0').value), parseInt(document.getElementById('editM1').value), parseInt(document.getElementById('editM2').value), parseInt(document.getElementById('editM3').value)];
    kf.boxPose = { z: parseInt(document.getElementById('editBoxZ').value) - VBOX_CONFIG.maxHeight, roll: parseInt(document.getElementById('editBoxRoll').value), pitch: parseInt(document.getElementById('editBoxPitch').value) };
    state.choreography.sort((a, b) => a.time - b.time);
    Storage.saveChoreographyToLocal();
    refreshUI();
};

window.closeKeyframeEditor = () => {
    document.getElementById('keyframeEditor').style.display = 'none';
    state.selectedKeyframeIndex = -1;
    refreshUI();
};

window.duplicateKeyframe = () => {
    if (state.selectedKeyframeIndex < 0) return;
    const kf = state.choreography[state.selectedKeyframeIndex];
    if (!kf) return;

    // Create a copy with time offset
    const newKf = JSON.parse(JSON.stringify(kf));
    newKf.time = kf.time + 0.5; // Offset by 0.5 seconds

    state.choreography.push(newKf);
    state.choreography.sort((a, b) => a.time - b.time);
    Storage.saveChoreographyToLocal();

    // Select the new keyframe
    const newIndex = state.choreography.findIndex(k => k === newKf);
    goToKeyframe(newIndex);
    debugLog('[Keyframe] Duplicated keyframe to time ' + newKf.time.toFixed(2));
};

function pasteKeyframe() {
    if (!state.copiedKeyframe) return;

    // Paste at current playhead time
    const newKf = JSON.parse(JSON.stringify(state.copiedKeyframe));
    newKf.time = state.currentTime;

    state.choreography.push(newKf);
    state.choreography.sort((a, b) => a.time - b.time);
    Storage.saveChoreographyToLocal();

    // Select the new keyframe
    const newIndex = state.choreography.findIndex(k => k === newKf);
    goToKeyframe(newIndex);
    debugLog('[Keyframe] Pasted keyframe at time ' + newKf.time.toFixed(2));
}

window.getCurrentForEditor = () => {
    for (let i = 0; i < 4; i++) document.getElementById(`editM${i}`).value = state.currentPositions[i];
    window.saveKeyframeChanges();
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

        // Ensure homeLengths are valid
        if (!state.homeLengths || state.homeLengths.length !== 4 || isNaN(state.homeLengths[0])) {
            initVirtualBox();
            console.log("Re-initialized virtual box");
        }

        const steps = calculateTargetSteps(state.boxState, state.homeLengths);

        // Debug Logging
        console.log("UpdateBox:", {
            z, r, p,
            logicalSteps: steps,
            reverseFlags: state.reverseFlags,
            motorMapping: state.motorMapping
        });

        if (steps.some(isNaN)) {
            throw new Error("Calculated steps contain NaN. Check Config.");
        }

        state.currentPositions = [...steps];
        const phys = applyMapping(steps);

        // Log to on-screen console for user visibility
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

    // Update slider max
    document.getElementById('boxZ').max = VBOX_CONFIG.maxHeight;
    document.getElementById('editBoxZ').max = VBOX_CONFIG.maxHeight;

    initVirtualBox(); // Recalculate home lengths
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

    // Scroll timeline to the left
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
    // Send volume to server
    Comms.sendAudioCommand('setVolume', { volume });
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

window.updateTimelineZoom = (value) => {
    state.timelineZoom = parseInt(value) || 20;
    document.getElementById('zoomDisplay').textContent = state.timelineZoom + ' px/s';
    localStorage.setItem('timelineZoom', state.timelineZoom);
    refreshUI();
};

window.clearConsole = () => document.getElementById('console').innerHTML = '';

function loadMapping() {
    const m = localStorage.getItem('motorMapping');
    if (m) {
        state.motorMapping = JSON.parse(m);
    } else {
        // Fallback to default if no local storage exists
        // This ensures the new config.js default is used
        state.motorMapping = [...state.motorMapping];
    }
    // Always sync dropdowns to state
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById(`mapM${i}`);
        if (el) el.value = state.motorMapping[i];
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
    if (f) {
        try {
            const flags = JSON.parse(f);
            state.reverseFlags = flags.map(x => !!x); // Ensure booleans
            console.log("Loaded Reverse Flags:", state.reverseFlags);
            const reverseIds = ['reverseX', 'reverseY', 'reverseZ', 'reverseA'];
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(reverseIds[i]);
                if (el) el.checked = state.reverseFlags[i];
            }
        } catch (e) {
            console.error("Error loading reverse flags:", e);
        }
    }
}

// Drag Handlers
document.addEventListener('mousedown', (e) => {
    // Allow clicking anywhere in the timeline area (white space or track) to move playhead
    // Check for timeline by ID or class, including the playhead and track
    const timeline = document.getElementById('timeline');
    const track = document.querySelector('.timeline-track');

    if (timeline && track) {
        const timelineRect = timeline.getBoundingClientRect();
        const isInTimeline = e.clientX >= timelineRect.left && e.clientX <= timelineRect.right &&
            e.clientY >= timelineRect.top && e.clientY <= timelineRect.bottom;

        if (isInTimeline && !e.target.classList.contains('keyframe-marker')) {
            e.preventDefault(); // Prevent text selection while dragging
            state.isDraggingPlayhead = true;

            const rect = track.getBoundingClientRect();
            const PPS = state.timelineZoom || 20;
            let t = (e.clientX - rect.left) / PPS;
            if (t < 0) t = 0;
            state.currentTime = t;
            UI.updatePlayhead(t);
            debugLog('[Timeline] Clicked at time:', t.toFixed(2));
        }
    }
});

// Keyboard shortcuts for copy/paste keyframes
document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    if (modKey && e.key === 'c') {
        // Copy selected keyframe
        if (state.selectedKeyframeIndex >= 0 && state.choreography[state.selectedKeyframeIndex]) {
            state.copiedKeyframe = JSON.parse(JSON.stringify(state.choreography[state.selectedKeyframeIndex]));
            debugLog('[Keyframe] Copied keyframe at index ' + state.selectedKeyframeIndex);
            e.preventDefault();
        }
    } else if (modKey && e.key === 'v') {
        // Paste copied keyframe
        if (state.copiedKeyframe) {
            pasteKeyframe();
            e.preventDefault();
        }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete selected keyframe
        if (state.selectedKeyframeIndex >= 0 && state.choreography[state.selectedKeyframeIndex]) {
            state.choreography.splice(state.selectedKeyframeIndex, 1);
            Storage.saveChoreographyToLocal();
            window.closeKeyframeEditor();
            debugLog('[Keyframe] Deleted keyframe at index ' + state.selectedKeyframeIndex);
            e.preventDefault();
        }
    } else if (e.key === ' ' || e.code === 'Space') {
        // Spacebar - play/pause toggle
        e.preventDefault();
        window.togglePlayback();
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
    state.isDraggingPlayhead = false;
    if (state.isDraggingKeyframe) {
        state.isDraggingKeyframe = false;
        state.choreography.sort((a, b) => a.time - b.time);
        Storage.saveChoreographyToLocal();
        refreshUI();
    }
});

window.updateMapping = () => {
    for (let i = 0; i < 4; i++) state.motorMapping[i] = parseInt(document.getElementById(`mapM${i}`).value);
    localStorage.setItem('motorMapping', JSON.stringify(state.motorMapping));

    // Check for duplicate mappings
    const uniqueDrivers = new Set(state.motorMapping);
    const warning = document.getElementById('mappingWarning');
    if (warning) {
        warning.style.display = uniqueDrivers.size < 4 ? 'inline' : 'none';
    }

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

window.syncHardware = () => {
    console.log("Syncing Hardware... Waiting 2s for boot...");
    setTimeout(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));

        // Sync Speed/Accel
        Comms.sendCommand(`S ${state.uiMaxSpeed}`);
        await wait(100);
        Comms.sendCommand(`A ${state.uiAcceleration}`);
        console.log("Hardware Synced (Speed/Accel only)");
    }, 2000);
};

document.addEventListener('DOMContentLoaded', () => {
    window.fetchPorts();
    loadMapping();
    loadReverseFlags();
    loadMicrostepping();
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

    // Load timeline zoom from localStorage
    const savedTimelineZoom = localStorage.getItem('timelineZoom');
    if (savedTimelineZoom !== null) state.timelineZoom = parseInt(savedTimelineZoom);
    document.getElementById('timelineZoom').value = state.timelineZoom;
    document.getElementById('zoomDisplay').textContent = state.timelineZoom + ' px/s';

    // Load volume from localStorage and sync with server
    const savedVolume = localStorage.getItem('audioVolume');
    if (savedVolume !== null) {
        const vol = parseInt(savedVolume);
        document.getElementById('volumeSlider').value = vol;
        document.getElementById('volumeDisplay').textContent = vol + '%';
        // Sync with server after a short delay to ensure connection is ready
        setTimeout(() => Comms.sendAudioCommand('setVolume', { volume: vol }), 1000);
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
                window.syncHardware();
            }
            else {
                ind.classList.remove('connected');
                txt.textContent = msg || 'Disconnected';
            }
        }, onPositionUpdate: () => { },
        onAudioStateUpdate: (audioState) => {
            // Update UI with server audio state
            if (audioState.fileName) {
                document.getElementById('audioStatus').textContent = audioState.fileName + ' (Pi)';
            }
            // Update current time from server if playing
            if (audioState.isPlaying) {
                state.serverAudioTime = audioState.currentTime;
            }
        },
        onChoreographySync: (data) => {
            // Received choreography update from another client
            debugLog('[App] Choreography sync received:', data.fileName);
            state.choreography = data.choreography || [];
            state.currentFileName = data.fileName || 'Untitled';
            if (data.reverseFlags) state.reverseFlags = data.reverseFlags;
            if (data.settings) {
                state.uiMaxSpeed = data.settings.speed || state.uiMaxSpeed;
                state.uiAcceleration = data.settings.accel || state.uiAcceleration;
                // Update UI
                document.getElementById('speed').value = state.uiMaxSpeed / 1000;
                document.getElementById('speedSlider').value = state.uiMaxSpeed / 1000;
                document.getElementById('accel').value = state.uiAcceleration / 1000;
                document.getElementById('accelSlider').value = state.uiAcceleration / 1000;
            }
            // Update reverse toggles
            for (let i = 0; i < 4; i++) {
                const checkbox = document.getElementById(`reverse${['X', 'Y', 'A', 'Z'][i]}`);
                if (checkbox) checkbox.checked = state.reverseFlags[i];
            }
            // Refresh the UI
            refreshUI();
            debugLog('[App] Choreography synced:', state.choreography.length, 'keyframes');
        }
    });
    Comms.connectWebSocket();
    Storage.loadChoreographyFromLocal({ onLoaded: () => refreshUI() });
    Storage.refreshQuickSaveList(updateQuickSaveDropdown);

    // Note: Server audio is now synced via WebSocket onAudioStateUpdate callback
    // Local IndexedDB audio is kept as fallback but server audio takes priority
    Storage.loadAudioFromDB({
        onAudioLoaded: (file) => {
            // Only use local audio if server audio is not loaded
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

// --- Calibration Logic ---
let calibrationStep = 0;
// Sequence: 0:RL(M0), 1:RR(M1), 2:FR(M2), 3:FL(M3) (Logical Indices)
const CALIBRATION_SEQUENCE = [
    { index: 0, name: "Motor 1 (Rear Left)", abbr: "RL", cx: 215, cy: 70 },
    { index: 1, name: "Motor 2 (Rear Right)", abbr: "RR", cx: 65, cy: 70 },
    { index: 2, name: "Motor 3 (Front Right)", abbr: "FR", cx: 65, cy: 170 },
    { index: 3, name: "Motor 4 (Front Left)", abbr: "FL", cx: 215, cy: 170 }
];

window.startCalibration = () => {
    // 1. Enable Motors
    document.getElementById('motorToggle').checked = true;
    Comms.sendCommand('E 1');

    // 2. Initialize State
    calibrationStep = 0;
    updateCalibrationUI();

    // 3. Show Modal
    document.getElementById('calibrationModal').style.display = 'flex';
};

window.nextCalibrationStep = () => {
    calibrationStep++;
    if (calibrationStep >= 4) {
        finishCalibration();
    } else {
        updateCalibrationUI();
    }
};

window.prevCalibrationStep = () => {
    if (calibrationStep > 0) {
        calibrationStep--;
        updateCalibrationUI();
    }
};

window.goToCalibrationStep = (step) => {
    if (step >= 0 && step < 4) {
        calibrationStep = step;
        updateCalibrationUI();
    }
};

window.cancelCalibration = () => {
    document.getElementById('calibrationModal').style.display = 'none';
};

window.finishCalibration = () => {
    // Set Zero
    window.setFloor();
    document.getElementById('calibrationModal').style.display = 'none';
    // Show brief success message in the UI instead of alert
    const statusText = document.getElementById('statusText');
    if (statusText) {
        const original = statusText.textContent;
        statusText.textContent = '✓ Calibration Complete!';
        statusText.style.color = '#00aa00';
        setTimeout(() => {
            statusText.textContent = original;
            statusText.style.color = '';
        }, 3000);
    }
};

window.calibrationMove = (dist) => {
    const motorInfo = CALIBRATION_SEQUENCE[calibrationStep];
    if (!motorInfo) return;

    // Move ONLY the active motor
    const logicalIndex = motorInfo.index;

    // Reuse quickMove logic but for specific index
    // quickMove(axisName, axisIndex, distanceMm)
    // We don't need axisName for logic, just index
    window.quickMove('CAL', logicalIndex, dist);
};

window.calibrationMoveAll = (dist) => {
    // Move all motors at once
    window.moveAllMotors(dist);
};

function updateCalibrationUI() {
    const stepInfo = CALIBRATION_SEQUENCE[calibrationStep];
    document.getElementById('calStepTitle').textContent = `Calibration Step ${calibrationStep + 1} of 4`;
    document.getElementById('calMotorName').textContent = `Adjust ${stepInfo.name}`;

    // Update visual corner indicator position
    const indicator = document.getElementById('calCornerIndicator');
    const dot = document.getElementById('calCornerDot');
    if (indicator && dot) {
        indicator.setAttribute('cx', stepInfo.cx);
        indicator.setAttribute('cy', stepInfo.cy);
        dot.setAttribute('cx', stepInfo.cx);
        dot.setAttribute('cy', stepInfo.cy);
    }

    // Update prev button visibility
    const prevBtn = document.getElementById('calPrevBtn');
    if (prevBtn) {
        prevBtn.style.display = calibrationStep === 0 ? 'none' : 'inline-block';
    }

    // Update next button text for final step
    const nextBtn = document.getElementById('calNextBtn');
    if (nextBtn) {
        if (calibrationStep === 3) {
            nextBtn.textContent = '✓ Finish Calibration';
        } else {
            nextBtn.innerHTML = 'Next Corner &rarr;';
        }
    }
}