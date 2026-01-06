import { VBOX_CONFIG } from './config.js';

export function getMotorPositions() {
  const w = VBOX_CONFIG.frameWidth / 2;
  const l = VBOX_CONFIG.frameLength / 2;
  
  // Standard Motor Mapping (Clockwise from Rear-Left)
  return [
    { x: -w, y: l, z: 0 },  // M1 (RL)
    { x: w, y: l, z: 0 },   // M2 (RR)
    { x: w, y: -l, z: 0 },  // M3 (FR)
    { x: -w, y: -l, z: 0 }  // M4 (FL)
  ];
}

export function calculateCorners(state) {
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

export function calculateDistance(p1, p2) {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) +
    Math.pow(p1.y - p2.y, 2) +
    Math.pow(p1.z - p2.z, 2)
  );
}

export function calculateTargetSteps(boxState, homeLengths) {
    const corners = calculateCorners(boxState);
    const motors = getMotorPositions();
    const targetSteps = [];
    
    for (let i = 0; i < 4; i++) {
      const len = calculateDistance(motors[i], corners[i]);
      let steps = (homeLengths[i] - len) * VBOX_CONFIG.stepsPerMm;
      targetSteps.push(Math.round(steps));
    }
    
    return targetSteps;
}
