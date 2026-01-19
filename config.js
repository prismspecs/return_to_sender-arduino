// --- Configuration & Constants ---

export const AXIS_NAMES = ['X', 'Y', 'Z', 'A'];

// Default Mapping: M1->X, M2->A, M3->Y, M4->Z
export const DEFAULT_MOTOR_MAPPING = [0, 3, 1, 2]; 

export const VBOX_CONFIG = {
  frameWidth: 700,  // Distance between motors Left/Right
  frameLength: 605, // Distance between motors Front/Rear (was 395)
  boxWidth: 450,    // Distance between corners X
  boxLength: 350,   // Distance between corners Y
  maxHeight: 2050,   // Max vertical travel (Rig Height)

  // Motor & Spool Physics
  spoolDiameter: 24,      // Diameter of the spool in mm
  motorStepsPerRev: 200,  // Steps per full revolution
  
  // Microstepping (Match CNC Shield jumpers)
  microsteps: 8,          
  
  // Dynamic calculation: Steps required to move 1mm
  get stepsPerMm() {
    const circumference = Math.PI * this.spoolDiameter;
    return (this.motorStepsPerRev * this.microsteps) / circumference;
  }
};

export const UI_CONFIG = {
    checkConnectionInterval: 5000,
    reconnectInterval: 2000,
    statusCheckDelay: 1000,
    defaultSpeed: 24000,
    defaultAccel: 24000
};