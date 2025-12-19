/*
 * CNC Shield v3 - 4 Axis Stepper Controller
 * * MODIFIED: Starts with motors DISABLED to prevent USB crash from EMI noise.
 * Type 'E 1' to enable motors.
 * 
 * MOTOR MAPPING (Top-Down View):
 * ------------------------------
 * Motor 1 (X-Axis Driver) -> Rear-Left Corner
 * Motor 2 (Y-Axis Driver) -> Rear-Right Corner
 * Motor 3 (Z-Axis Driver) -> Front-Right Corner
 * Motor 4 (A-Axis Driver) -> Front-Left Corner
 * 
 * Coordinate System:
 * Width  = Distance between M1 & M2 (and M4 & M3)
 * Length = Distance between M2 & M3 (and M1 & M4)
 */

#include <AccelStepper.h>

// ============================================================================
// PIN DEFINITIONS FOR CNC SHIELD V3
// ============================================================================
// These pins map to the standard CNC Shield V3 layout on an Arduino Uno.
#define X_STEP_PIN 2
#define X_DIR_PIN 5
#define Y_STEP_PIN 3
#define Y_DIR_PIN 6
#define Z_STEP_PIN 4
#define Z_DIR_PIN 7
#define A_STEP_PIN 12
#define A_DIR_PIN 13

// Enable Pin: Controls power to the stepper drivers.
// LOW = Enabled (Motors hold torque)
// HIGH = Disabled (Motors spin freely)
#define ENABLE_PIN 8    // Controls X, Y, Z drivers
#define A_ENABLE_PIN 8  // A-axis enable (usually tied to pin 8 on CNC shield)

// ============================================================================
// CONFIGURATION
// ============================================================================
#define SPEED_DEFAULT 4000   // Max speed in steps/second
#define ACCEL_DEFAULT 2000   // Acceleration in steps/second^2

const int NUM_STEPPERS = 4;
const char* AXIS_NAMES[] = { "X", "Y", "Z", "A" };

// Timeout Configuration
unsigned long lastCommandTime = 0;
const unsigned long TIMEOUT_MS = 600000; // 10 minutes (10 * 60 * 1000)
bool motorsEnabled = false; // Track motor state
bool inverted[4] = {false, false, false, false}; // Track inversion state

// Initialize AccelStepper objects for each motor
AccelStepper steppers[NUM_STEPPERS] = {
  AccelStepper(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN), // Motor 1 (Rear-Left)
  AccelStepper(AccelStepper::DRIVER, Y_STEP_PIN, Y_DIR_PIN), // Motor 2 (Rear-Right)
  AccelStepper(AccelStepper::DRIVER, Z_STEP_PIN, Z_DIR_PIN), // Motor 3 (Front-Right)
  AccelStepper(AccelStepper::DRIVER, A_STEP_PIN, A_DIR_PIN)  // Motor 4 (Front-Left)
};

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200); // Start serial communication at 115200 baud

  // Configure Step/Dir pins as outputs
  pinMode(X_STEP_PIN, OUTPUT);
  pinMode(X_DIR_PIN, OUTPUT);
  pinMode(Y_STEP_PIN, OUTPUT);
  pinMode(Y_DIR_PIN, OUTPUT);
  pinMode(Z_STEP_PIN, OUTPUT);
  pinMode(Z_DIR_PIN, OUTPUT);
  pinMode(A_STEP_PIN, OUTPUT);
  pinMode(A_DIR_PIN, OUTPUT);

  // --- CRITICAL SAFETY FEATURE ---
  // START WITH MOTORS DISABLED (HIGH)
  // This prevents electrical noise from crashing the USB connection at startup.
  // It also prevents sudden jerks when powering on.
  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, HIGH); 
  motorsEnabled = false;
  lastCommandTime = millis();

  if (A_ENABLE_PIN != ENABLE_PIN) {
    pinMode(A_ENABLE_PIN, OUTPUT);
    digitalWrite(A_ENABLE_PIN, HIGH);
  }

  // Configure motor speed and acceleration
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].setMaxSpeed(SPEED_DEFAULT);
    steppers[i].setAcceleration(ACCEL_DEFAULT);
  }

  // INVERT DIRECTIONS IF NEEDED
  // Adjust these true/false values if a motor spins the wrong way.
  // Syntax: setPinsInverted(direction, step, enable)
  // inverted[0] = true;
  // inverted[2] = true;
  // steppers[0].setPinsInverted(inverted[0], false, false); // Invert Motor 1
  // steppers[2].setPinsInverted(inverted[2], false, false); // Invert Motor 3

  // Print welcome message and instructions
  Serial.println("Arduino Stepper Controller Ready.");
  Serial.println("STATUS: Motors are DISABLED (Silent Mode).");
  Serial.println("Type 'E 1' to enable motors (Warning: Noise may occur).");
  Serial.println();
  Serial.println("Commands:");
  Serial.println(" M <x> <y> <z> <a> : Move absolute (to specific position)");
  Serial.println(" R <x> <y> <z> <a> : Move relative (from current position)");
  Serial.println(" S <speed>         : Set max speed (steps/sec)");
  Serial.println(" A <accel>         : Set acceleration (steps/sec^2)");
  Serial.println(" H                 : Home (set current position as 0)");
  Serial.println(" E 1               : Enable Motors (Energize coils)");
  Serial.println(" E 0               : Disable Motors (Release coils)");
  Serial.println(" I                 : Info / Status check");
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
  // This function must run as fast as possible to generate smooth steps.
  // Do not add delay() here!
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].run(); // Checks if a step is due and executes it
  }
  checkSerial(); // Check for new commands from computer

  // Check for inactivity timeout
  if (motorsEnabled && (millis() - lastCommandTime > TIMEOUT_MS)) {
    digitalWrite(ENABLE_PIN, HIGH);
    if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, HIGH);
    motorsEnabled = false;
    Serial.println("Timeout: Motors DISABLED due to inactivity.");
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Blocking function that waits until all motors reach their target
void waitForMotors() {
  bool moving = true;
  while (moving) {
    moving = false;
    for (int i = 0; i < NUM_STEPPERS; i++) {
      steppers[i].run(); // Keep stepping!
      if (steppers[i].distanceToGo() != 0) {
        moving = true; // At least one motor is still moving
      }
    }
  }
}

// Parse and execute serial commands
void checkSerial() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim(); // Remove whitespace
    
    // Reset timeout timer on any command
    lastCommandTime = millis();

    // --- ENABLE/DISABLE MOTORS (E) ---
    if (command.startsWith("E")) {
      int state = command.substring(1).toInt();
      if (state == 1) {
        digitalWrite(ENABLE_PIN, LOW); // LOW = ON
        if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, LOW);
        motorsEnabled = true;
        Serial.println("Motors ENABLED.");
      } else {
        digitalWrite(ENABLE_PIN, HIGH); // HIGH = OFF
        if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, HIGH);
        motorsEnabled = false;
        Serial.println("Motors DISABLED.");
      }
    }
    // --- MOVE ABSOLUTE (M) ---
    else if (command.startsWith("M")) {
      long s1, s2, s3, s4;
      // Parse 4 integers from the command string
      if (sscanf(command.c_str(), "M %ld %ld %ld %ld", &s1, &s2, &s3, &s4) == 4) {
        Serial.println("Moving...");
        steppers[0].moveTo(s1);
        steppers[1].moveTo(s2);
        steppers[2].moveTo(s3);
        steppers[3].moveTo(s4);
        waitForMotors(); // Wait until move is complete
        Serial.println("Done.");
      }
    }
    // --- MOVE RELATIVE (R) ---
    else if (command.startsWith("R")) {
      long s1, s2, s3, s4;
      if (sscanf(command.c_str(), "R %ld %ld %ld %ld", &s1, &s2, &s3, &s4) == 4) {
        Serial.print("Moving Relative: ");
        Serial.print(s1); Serial.print(", ");
        Serial.print(s2); Serial.print(", ");
        Serial.print(s3); Serial.print(", ");
        Serial.println(s4);
        
        steppers[0].move(s1);
        steppers[1].move(s2);
        steppers[2].move(s3);
        steppers[3].move(s4);
        waitForMotors();
        Serial.println("Done.");
      }
    }
    // --- INFO / STATUS (I) ---
    else if (command.startsWith("I")) {
      Serial.println("Connection Active.");
      Serial.print("Motors: ");
      if (digitalRead(ENABLE_PIN) == LOW) {
        Serial.println("ENABLED");
      } else {
        Serial.println("DISABLED");
      }
      Serial.print("Inverted: ");
      for(int i=0; i<4; i++) {
        Serial.print(AXIS_NAMES[i]);
        Serial.print("=");
        Serial.print(inverted[i] ? "1" : "0");
        if(i<3) Serial.print(" ");
      }
      Serial.println();
      // Report positions for ALL motors so the UI can sync correctly.
      // Previously only reported X, causing other motors to reset to 0 on absolute moves.
      for (int i = 0; i < NUM_STEPPERS; i++) {
        Serial.print(AXIS_NAMES[i]);
        Serial.print(": pos=");
        Serial.println(steppers[i].currentPosition());
      }
    }
    // --- SET INVERSION (V) ---
    else if (command.startsWith("V")) {
      // Syntax: V <axis_index> <state>
      // Example: V 0 1 (Invert X)
      int axis, state;
      if (sscanf(command.c_str(), "V %d %d", &axis, &state) == 2) {
        if (axis >= 0 && axis < 4) {
          inverted[axis] = (state == 1);
          steppers[axis].setPinsInverted(inverted[axis], false, false);
          Serial.print("Axis ");
          Serial.print(AXIS_NAMES[axis]);
          Serial.print(" Inverted: ");
          Serial.println(inverted[axis] ? "YES" : "NO");
        }
      }
    }
    // --- SET SPEED (S) ---
    else if (command.startsWith("S")) {
      float speed = command.substring(1).toFloat();
      if (speed > 0) {
        for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setMaxSpeed(speed);
        Serial.print("Speed set to: "); Serial.println(speed);
      }
    }
    // --- SET ACCELERATION (A) ---
    else if (command.startsWith("A")) {
      float accel = command.substring(1).toFloat();
      if (accel > 0) {
        for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setAcceleration(accel);
        Serial.print("Accel set to: "); Serial.println(accel);
      }
    }
    // --- HOME / ZERO (H) ---
    else if (command.startsWith("H")) {
      for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setCurrentPosition(0);
      Serial.println("Homed (All positions set to 0).");
    }
  }
}