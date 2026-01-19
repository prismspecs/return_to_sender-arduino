/*
 * CNC Shield v3 - 4 Axis Stepper Controller
 * Optimized for Performance on Arduino Uno R4
 * 
 * Hardware:
 * - Arduino Uno R4 (Minima/WiFi)
 * - CNC Shield v3
 * - 4x Stepper Drivers (A4988/DRV8825)
 * - 4x NEMA 17 Stepper Motors
 * 
 * Features:
 * - Non-blocking AccelStepper implementation
 * - Serial Command Interface (115200 baud)
 * - Dynamic Speed/Acceleration control
 * - Individual Axis Inversion
 * - Watchdog Timeout (Auto-disable motors)
 */

#include <AccelStepper.h>

// ============================================================================
// PIN DEFINITIONS (CNC Shield v3 Standard)
// ============================================================================

// X-Axis
#define X_STEP_PIN 2
#define X_DIR_PIN 5

// Y-Axis
#define Y_STEP_PIN 3
#define Y_DIR_PIN 6

// Z-Axis
#define Z_STEP_PIN 4
#define Z_DIR_PIN 7

// A-Axis (Duplicate of X, Y, Z or Independent 4th Axis depending on jumpers)
// Here configured as Independent 4th Axis (D12/D13)
#define A_STEP_PIN 12
#define A_DIR_PIN 13

// Enable Pin (Shared by all axes on CNC Shield v3)
#define ENABLE_PIN 8    
#define A_ENABLE_PIN 8  

// ============================================================================
// CONFIGURATION & TUNING
// ============================================================================

// --- MICROSTEPPING & SPEED SETTINGS ---
// Current Setup: 1/8 Microstepping
// 1.8 deg motor = 200 steps/rev
// 1/8 microstepping = 1600 steps/rev
//
// Spool Geometry:
// Trough diameter = 24mm
// Circumference = π * 24mm = 75.4mm/rev
// Linear resolution = 1600 steps / 75.4mm = 21.2 steps/mm

// Speed & Acceleration
// Note: Arduino Uno R4 (48MHz) can handle higher interrupt rates than R3.
// 24000 steps/sec @ 1600 steps/rev = 15 revs/sec = 1131 mm/sec
#define SPEED_DEFAULT 24000.0
#define ACCEL_DEFAULT 24000.0

// Safety & Watchdog
const unsigned long TIMEOUT_MS = 2000; // Disable motors if no command received for 2s

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

const int NUM_STEPPERS = 4;
const char* AXIS_NAMES[] = { "X", "Y", "Z", "A" };

// State Tracking
unsigned long lastCommandTime = 0;
bool motorsEnabled = false; 
bool inverted[4] = {true, false, true, false}; // Default: X and Z Inverted 

// Stepper Objects
AccelStepper steppers[NUM_STEPPERS] = {
  AccelStepper(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN), 
  AccelStepper(AccelStepper::DRIVER, Y_STEP_PIN, Y_DIR_PIN), 
  AccelStepper(AccelStepper::DRIVER, Z_STEP_PIN, Z_DIR_PIN), 
  AccelStepper(AccelStepper::DRIVER, A_STEP_PIN, A_DIR_PIN)  
};

// Serial Buffer
const int MAX_CMD_LENGTH = 64;
char cmdBuffer[MAX_CMD_LENGTH];
int cmdIndex = 0;

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  // Initialize Serial
  Serial.begin(115200); 

  // Initialize Pins
  pinMode(X_STEP_PIN, OUTPUT); pinMode(X_DIR_PIN, OUTPUT);
  pinMode(Y_STEP_PIN, OUTPUT); pinMode(Y_DIR_PIN, OUTPUT);
  pinMode(Z_STEP_PIN, OUTPUT); pinMode(Z_DIR_PIN, OUTPUT);
  pinMode(A_STEP_PIN, OUTPUT); pinMode(A_DIR_PIN, OUTPUT);

  // Initialize Enable Pin (Active LOW, so HIGH = Disabled)
  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, HIGH); 
  
  if (A_ENABLE_PIN != ENABLE_PIN) {
    pinMode(A_ENABLE_PIN, OUTPUT);
    digitalWrite(A_ENABLE_PIN, HIGH);
  }

  // Initialize Steppers
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].setMaxSpeed(SPEED_DEFAULT);
    steppers[i].setAcceleration(ACCEL_DEFAULT);
    // Apply default inversion
    steppers[i].setPinsInverted(inverted[i], false, false);
  }

  // Reset State
  motorsEnabled = false;
  lastCommandTime = millis();

  Serial.println("Arduino Stepper Controller Ready (Optimized for R4).");
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
  // CRITICAL: This loop must run as fast as possible.
  // Avoid delay() or long blocking operations here.
  
  // 1. Step Motors
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].run(); 
  }
  
  // 2. Process Incoming Commands
  checkSerial(); 

  // 3. Watchdog Timer (Safety Cutoff)
  if (motorsEnabled && (millis() - lastCommandTime > TIMEOUT_MS)) {
    disableMotors();
    Serial.println("Timeout: Motors DISABLED.");
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

void enableMotors() {
  digitalWrite(ENABLE_PIN, LOW);
  if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, LOW);
  motorsEnabled = true;
}

void disableMotors() {
  digitalWrite(ENABLE_PIN, HIGH);
  if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, HIGH);
  motorsEnabled = false;
}

void checkSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      cmdBuffer[cmdIndex] = '\0'; // Null terminate
      processCommand(cmdBuffer);
      cmdIndex = 0; // Reset buffer
    } else {
      if (cmdIndex < MAX_CMD_LENGTH - 1) {
        cmdBuffer[cmdIndex++] = c;
      }
    }
  }
}

// ============================================================================
// COMMAND PROCESSOR
// ============================================================================
/*
 * Supported Commands:
 * E <0/1>          - Enable/Disable Motors (0=Off, 1=On)
 * M <x> <y> <z> <a> - Move Absolute (Steps)
 * R <x> <y> <z> <a> - Move Relative (Steps)
 * S <val>          - Set Max Speed (Steps/sec)
 * A <val>          - Set Acceleration (Steps/sec^2)
 * V <axis> <0/1>   - Invert Axis (0=Normal, 1=Inverted)
 * H                - Home (Set current position to 0)
 * I                - Info / Status Report
 * P                - Ping (Keep-alive)
 */
void processCommand(char* command) {
    lastCommandTime = millis();
    char cmdType = command[0];
    
    switch(cmdType) {
      // E: Enable/Disable
      case 'E': {
        int state = atoi(command + 1);
        if (state == 1) {
          enableMotors();
          Serial.println("Motors: ENABLED");
        } else {
          disableMotors();
          Serial.println("Motors: DISABLED");
        }
        break;
      }

      // M: Move Absolute
      case 'M': {
        long s1, s2, s3, s4;
        if (sscanf(command, "M %ld %ld %ld %ld", &s1, &s2, &s3, &s4) == 4) {
          steppers[0].moveTo(s1);
          steppers[1].moveTo(s2);
          steppers[2].moveTo(s3);
          steppers[3].moveTo(s4);
        }
        break;
      }

      // R: Move Relative
      case 'R': {
        long s1, s2, s3, s4;
        if (sscanf(command, "R %ld %ld %ld %ld", &s1, &s2, &s3, &s4) == 4) {
          steppers[0].move(s1);
          steppers[1].move(s2);
          steppers[2].move(s3);
          steppers[3].move(s4);
        }
        break;
      }

      // S: Set Speed
      case 'S': {
        float speed = atof(command + 1);
        if (speed > 0) {
          for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setMaxSpeed(speed);
          Serial.print("Speed set to: "); Serial.println(speed);
        }
        break;
      }

      // A: Set Acceleration
      case 'A': {
        float accel = atof(command + 1);
        if (accel > 0) {
          for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setAcceleration(accel);
          Serial.print("Accel set to: "); Serial.println(accel);
        }
        break;
      }

      // V: Invert Axis
      case 'V': {
        int axis, state;
        if (sscanf(command, "V %d %d", &axis, &state) == 2) {
          if (axis >= 0 && axis < 4) {
            inverted[axis] = (state == 1);
            steppers[axis].setPinsInverted(inverted[axis], false, false);
            Serial.print("Axis "); Serial.print(AXIS_NAMES[axis]); 
            Serial.println(inverted[axis] ? " Inverted: YES" : " Inverted: NO");
          }
        }
        break;
      }

      // H: Home (Set Zero)
      case 'H': {
        for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setCurrentPosition(0);
        Serial.println("Homed.");
        break;
      }

      // I: Info / Status
      case 'I': {
        Serial.println("Connection Active.");
        Serial.print("Motors: ");
        Serial.println(motorsEnabled ? "ENABLED" : "DISABLED");
        
        Serial.print("Inverted: ");
        for(int i=0; i<4; i++) {
          Serial.print(AXIS_NAMES[i]); Serial.print("="); Serial.print(inverted[i] ? "1" : "0");
          if(i<3) Serial.print(" ");
        }
        Serial.println();
        
        for (int i = 0; i < NUM_STEPPERS; i++) {
          Serial.print(AXIS_NAMES[i]); Serial.print(": pos="); Serial.println(steppers[i].currentPosition());
        }
        break;
      }

      // P: Ping
      case 'P':
        // Just resets watchdog via lastCommandTime update
        break;

      // Q: Quick Stop (Graceful Halt)
      case 'Q': {
        for (int i = 0; i < NUM_STEPPERS; i++) {
          steppers[i].stop(); 
        }
        Serial.println("STOPPING.");
        break;
      }
    }
}