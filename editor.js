import { state } from './state.js';
import * as Storage from './storage.js';
import { VBOX_CONFIG } from './config.js';
import { calculateTargetSteps } from './kinematics.js';
import { updatePlayhead, updateTimeline, updateKeyframesList, updateFileNameDisplay } from './ui.js';

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

function refreshUI() {
    updateKeyframesList(uiCallbacks);
    updateTimeline(uiCallbacks);
    updateFileNameDisplay();
}

export function goToKeyframe(index) {
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
    updateEditorFromBox(true);
    refreshUI();
}

export function updateEditorFromBox(skipApply) {
    const z = document.getElementById('editBoxZ').value;
    const r = document.getElementById('editBoxRoll').value;
    const p = document.getElementById('editBoxPitch').value;
    document.getElementById('dispEditBoxZ').textContent = z;
    document.getElementById('dispEditBoxRoll').textContent = r + '°';
    document.getElementById('dispEditBoxPitch').textContent = p + '°';
    if (!skipApply) {
        const steps = calculateTargetSteps({ z: parseInt(z) - VBOX_CONFIG.maxHeight, roll: parseInt(r), pitch: parseInt(p) }, state.homeLengths);
        for (let i = 0; i < 4; i++) document.getElementById(`editM${i}`).value = steps[i];
        saveKeyframeChanges();
    }
}

export function saveKeyframeChanges() {
    if (state.selectedKeyframeIndex === -1) return;
    const kf = state.choreography[state.selectedKeyframeIndex];
    if (!kf) return;
    kf.time = parseFloat(document.getElementById('editTime').value);
    
    let s = parseFloat(document.getElementById('editSpeed').value);
    if (isNaN(s)) s = state.uiMaxSpeed / 1000;
    kf.speed = s * 1000;
    
    let a = parseFloat(document.getElementById('editAccel').value);
    if (isNaN(a)) a = state.uiAcceleration / 1000;
    kf.accel = a * 1000;
    
    kf.positions = [parseInt(document.getElementById('editM0').value), parseInt(document.getElementById('editM1').value), parseInt(document.getElementById('editM2').value), parseInt(document.getElementById('editM3').value)];
    kf.boxPose = { z: parseInt(document.getElementById('editBoxZ').value) - VBOX_CONFIG.maxHeight, roll: parseInt(document.getElementById('editBoxRoll').value), pitch: parseInt(document.getElementById('editBoxPitch').value) };
    state.choreography.sort((a, b) => a.time - b.time);
    Storage.saveChoreographyToLocal();
    refreshUI();
}

export function closeKeyframeEditor() {
    document.getElementById('keyframeEditor').style.display = 'none';
    state.selectedKeyframeIndex = -1;
    refreshUI();
}

export function duplicateKeyframe() {
    if (state.selectedKeyframeIndex < 0) return;
    const kf = state.choreography[state.selectedKeyframeIndex];
    if (!kf) return;

    const newKf = JSON.parse(JSON.stringify(kf));
    newKf.time = kf.time + 0.5;

    state.choreography.push(newKf);
    state.choreography.sort((a, b) => a.time - b.time);
    Storage.saveChoreographyToLocal();

    const newIndex = state.choreography.findIndex(k => k === newKf);
    goToKeyframe(newIndex);
}

export function pasteKeyframe() {
    if (!state.copiedKeyframe) return;

    const newKf = JSON.parse(JSON.stringify(state.copiedKeyframe));
    newKf.time = state.currentTime;

    state.choreography.push(newKf);
    state.choreography.sort((a, b) => a.time - b.time);
    Storage.saveChoreographyToLocal();

    const newIndex = state.choreography.findIndex(k => k === newKf);
    goToKeyframe(newIndex);
}

export function getCurrentForEditor() {
    for (let i = 0; i < 4; i++) document.getElementById(`editM${i}`).value = state.currentPositions[i];
    saveKeyframeChanges();
}

// --- Event Listeners ---
// These are added to the document, so we can init them here or export a setup function
// For module simplicity, let's export a setup function that app.js calls.

export function setupEditorShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const modKey = isMac ? e.metaKey : e.ctrlKey;

        if (modKey && e.key === 'c') {
            if (state.selectedKeyframeIndex >= 0 && state.choreography[state.selectedKeyframeIndex]) {
                state.copiedKeyframe = JSON.parse(JSON.stringify(state.choreography[state.selectedKeyframeIndex]));
                e.preventDefault();
            }
        } else if (modKey && e.key === 'v') {
            if (state.copiedKeyframe) {
                pasteKeyframe();
                e.preventDefault();
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (state.selectedKeyframeIndex >= 0 && state.choreography[state.selectedKeyframeIndex]) {
                state.choreography.splice(state.selectedKeyframeIndex, 1);
                Storage.saveChoreographyToLocal();
                closeKeyframeEditor();
                e.preventDefault();
            }
        } else if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            if(window.togglePlayback) window.togglePlayback();
        }
    });
}

// Attach to window
window.goToKeyframe = goToKeyframe; // Needed for app.js UI callbacks
window.updateEditorFromBox = updateEditorFromBox;
window.saveKeyframeChanges = saveKeyframeChanges;
window.closeKeyframeEditor = closeKeyframeEditor;
window.duplicateKeyframe = duplicateKeyframe;
window.getCurrentForEditor = getCurrentForEditor;
window.refreshUI = refreshUI; // Exported for use in other modules if needed
