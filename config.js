// --- Configuration & Constants ---

export const PHYSICAL_Z_OFFSET = -900; 

export const AXIS_NAMES = ['X', 'Y', 'Z', 'A'];

// Default Mapping: M1->X, M2->Y, M3->A, M4->Z
export const DEFAULT_MOTOR_MAPPING = [0, 1, 3, 2]; 

export const VBOX_CONFIG = {
  frameWidth: 560,  // Distance between motors Left/Right
  frameLength: 400, // Distance between motors Front/Rear
  boxWidth: 450,    // Distance between corners X
  boxLength: 350,   // Distance between corners Y
  
  // Motor & Spool Physics
  spoolDiameter: 35,      // Diameter of the spool in mm
  motorStepsPerRev: 200,  // Steps per full revolution
  
  // Microstepping (Match CNC Shield jumpers)
  microsteps: 16,          
  
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