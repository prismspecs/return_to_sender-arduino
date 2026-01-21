import { VBOX_CONFIG } from './config.js';
import { state } from './state.js';
import * as Comms from './comms.js';

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

export function updateMicrosteppingOptions() {
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

export function updateMicrostepping() {
    const select = document.getElementById('microstepping');
    const ms = parseInt(select.value);
    VBOX_CONFIG.microsteps = ms;
    localStorage.setItem('microsteps', ms);
}

export function loadMicrostepping() {
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

export function saveConfig() {
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
}

export function loadConfig() {
    document.getElementById('configFileInput').click();
}

export function handleConfigLoad(e) {
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

            updateMicrosteppingOptions();

            // Rest UI
            document.getElementById('restEnabled').checked = state.restEnabled;
            document.getElementById('restDuration').value = state.restDuration;

            // Timeline UI
            document.getElementById('timelineDuration').value = state.timelineDuration;

            // Recalc
            if (window.initVirtualBox) window.initVirtualBox();
            if (window.refreshUI) window.refreshUI();

            alert("Config loaded successfully");

        } catch (e) { console.error('Error loading config:', e); alert('Invalid config file'); }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// Attach to window
window.saveConfig = saveConfig;
window.loadConfig = loadConfig;
window.handleConfigLoad = handleConfigLoad;
window.updateMicrosteppingOptions = updateMicrosteppingOptions;
window.updateMicrostepping = updateMicrostepping;
