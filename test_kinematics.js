import { getMotorPositions, calculateCorners, calculateTargetSteps, calculateDistance } from './kinematics.js';
import { VBOX_CONFIG } from './config.js';

// Mock state
const state = {
    z: -1000, // Mid-air
    roll: 0,
    pitch: 10 // 10 degrees pitch (Nose Up or Down?)
};

// Calculate Home Lengths (at Floor)
VBOX_CONFIG.maxHeight = 2000;
const homeZ = -2000;
const cornersHome = calculateCorners({ z: homeZ, roll: 0, pitch: 0 });
const motors = getMotorPositions();
const homeLengths = [];
for(let i=0; i<4; i++) {
    homeLengths[i] = calculateDistance(motors[i], cornersHome[i]);
}

console.log("--- Setup ---");
console.log("Motors (RL, RR, FR, FL):", motors);
console.log("Home Lengths:", homeLengths);

console.log("\n--- Pitch Test (+10 deg) ---");
const steps = calculateTargetSteps(state, homeLengths);

console.log("Target Steps:", steps);

// Analyze Delta
// M1 (RL), M2 (RR) should be REAR (+Y)
// M3 (FR), M4 (FL) should be FRONT (-Y)

const flatState = { z: -1000, roll: 0, pitch: 0 };
const flatSteps = calculateTargetSteps(flatState, homeLengths);
console.log("Flat Steps (Pitch 0):", flatSteps);

console.log("\n--- Delta (Pitched - Flat) ---");
const deltas = steps.map((s, i) => s - flatSteps[i]);
console.log("M1 (RL) Delta:", deltas[0]);
console.log("M2 (RR) Delta:", deltas[1]);
console.log("M3 (FR) Delta:", deltas[2]);
console.log("M4 (FL) Delta:", deltas[3]);

if (deltas[0] > 0 && deltas[1] > 0 && deltas[2] < 0 && deltas[3] < 0) {
    console.log("RESULT: REAR Retracts, FRONT Extends -> Nose Down (if +Steps = Up)");
} else if (deltas[0] < 0 && deltas[1] < 0 && deltas[2] > 0 && deltas[3] > 0) {
    console.log("RESULT: REAR Extends, FRONT Retracts -> Nose Up (if +Steps = Up)");
} else {
    console.log("RESULT: Mixed/Twisted?");
}
