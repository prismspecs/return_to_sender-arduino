import { state } from './state.js';
import * as Comms from './comms.js';

let calibrationStep = 0;

// Sequence: 0:RL(M0), 1:RR(M1), 2:FR(M2), 3:FL(M3) (Logical Indices)
const CALIBRATION_SEQUENCE = [
    { index: 0, name: "Motor 1 (Rear Left)", abbr: "RL", cx: 215, cy: 70 },
    { index: 1, name: "Motor 2 (Rear Right)", abbr: "RR", cx: 65, cy: 70 },
    { index: 2, name: "Motor 3 (Front Right)", abbr: "FR", cx: 65, cy: 170 },
    { index: 3, name: "Motor 4 (Front Left)", abbr: "FL", cx: 215, cy: 170 }
];

export function startCalibration() {
    // 1. Enable Motors
    const toggle = document.getElementById('motorToggle');
    if (toggle) toggle.checked = true;
    Comms.sendCommand('E 1');

    // 2. Initialize State
    calibrationStep = 0;
    updateCalibrationUI();

    // 3. Show Modal
    document.getElementById('calibrationModal').style.display = 'flex';
}

export function nextCalibrationStep() {
    calibrationStep++;
    if (calibrationStep >= 4) {
        finishCalibration();
    } else {
        updateCalibrationUI();
    }
}

export function prevCalibrationStep() {
    if (calibrationStep > 0) {
        calibrationStep--;
        updateCalibrationUI();
    }
}

export function goToCalibrationStep(step) {
    if (step >= 0 && step < 4) {
        calibrationStep = step;
        updateCalibrationUI();
    }
}

export function cancelCalibration() {
    document.getElementById('calibrationModal').style.display = 'none';
}

export function finishCalibration() {
    // Set Zero
    if (window.setFloor) window.setFloor();
    else console.warn("window.setFloor not available");
    
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
}

export function calibrationMove(dist) {
    const motorInfo = CALIBRATION_SEQUENCE[calibrationStep];
    if (!motorInfo) return;

    // Move ONLY the active motor
    const logicalIndex = motorInfo.index;

    // Reuse quickMove logic but for specific index
    if (window.quickMove) {
        window.quickMove('CAL', logicalIndex, dist);
    }
}

export function calibrationMoveAll(dist) {
    if (window.moveAllMotors) {
        window.moveAllMotors(dist);
    }
}

function updateCalibrationUI() {
    const stepInfo = CALIBRATION_SEQUENCE[calibrationStep];
    const title = document.getElementById('calStepTitle');
    const name = document.getElementById('calMotorName');
    
    if (title) title.textContent = `Calibration Step ${calibrationStep + 1} of 4`;
    if (name) name.textContent = `Adjust ${stepInfo.name}`;

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

// Attach to window for HTML button clicks
window.startCalibration = startCalibration;
window.nextCalibrationStep = nextCalibrationStep;
window.prevCalibrationStep = prevCalibrationStep;
window.goToCalibrationStep = goToCalibrationStep;
window.cancelCalibration = cancelCalibration;
window.finishCalibration = finishCalibration;
window.calibrationMove = calibrationMove;
window.calibrationMoveAll = calibrationMoveAll;
