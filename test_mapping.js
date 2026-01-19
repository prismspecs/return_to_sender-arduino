import { getMotorPositions, calculateCorners, calculateTargetSteps, calculateDistance } from './kinematics.js';
import { VBOX_CONFIG } from './config.js';

// Setup basic environment
VBOX_CONFIG.maxHeight = 2000;
const homeZ = -1000; // Start mid-air
const motors = getMotorPositions();

// 1. Verify Motor Coordinates
console.log("\n=== 1. Motor Coordinate Verification ===");
const names = ["M0 (RL)", "M1 (RR)", "M2 (FR)", "M3 (FL)"];
motors.forEach((m, i) => {
    let pos = "";
    if (m.y > 0) pos += "REAR "; else pos += "FRONT ";
    if (m.x > 0) pos += "RIGHT"; else pos += "LEFT";
    console.log(`${names[i]}: [${m.x}, ${m.y}] -> ${pos}`);
});

// 2. Simulate Pitch -41 (Nose UP - Front Rises, Rear Drops)
// Rises = Retracts (Shorter cable) = Higher Steps (assuming 0 is floor)
// Drops = Extends (Longer cable) = Lower Steps
console.log("\n=== 2. Pitch Test: -41 deg (Nose Up?)");
const stateFlat = { z: homeZ, roll: 0, pitch: 0 };
const statePitched = { z: homeZ, roll: 0, pitch: -41 };

// Calculate Home Lengths (Virtual Floor)
const cornersHome = calculateCorners({ z: -2000, roll: 0, pitch: 0 });
const homeLengths = motors.map((m, i) => calculateDistance(m, cornersHome[i]));

const stepsFlat = calculateTargetSteps(stateFlat, homeLengths);
const stepsPitched = calculateTargetSteps(statePitched, homeLengths);

console.log("Flat Steps:", stepsFlat);
console.log("Pitched Steps:", stepsPitched);

console.log("\n=== 3. Delta Analysis ===");
stepsPitched.forEach((s, i) => {
    const diff = s - stepsFlat[i];
    const action = diff > 0 ? "RETRACT (Up/Tighten)" : "EXTEND (Down/Slack)";
    console.log(`${names[i]}: Delta ${diff} -> ${action}`);
});

// Hypothesis Check
console.log("\n=== 4. Hypothesis Check ===");
console.log("Expected for Nose Up (Negative Pitch):");
console.log("  REAR (M0, M1) should EXTEND (Slack)");
console.log("  FRONT (M2, M3) should RETRACT (Tighten)");
