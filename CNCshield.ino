/*
 * CNC Shield v3 - 4 Axis Stepper Controller
 * Optimized for Performance
 */

#include <AccelStepper.h>

// ============================================================================
// PIN DEFINITIONS FOR CNC SHIELD V3
// ============================================================================
#define X_STEP_PIN 2
#define X_DIR_PIN 5
#define Y_STEP_PIN 3
#define Y_DIR_PIN 6
#define Z_STEP_PIN 4
#define Z_DIR_PIN 7
#define A_STEP_PIN 12
#define A_DIR_PIN 13

#define ENABLE_PIN 8    
#define A_ENABLE_PIN 8  

// ============================================================================
// CONFIGURATION
// ============================================================================

// --- MICROSTEPPING & SPEED SETTINGS ---
// Adjust these values based on your hardware configuration.
// Max Speed for Arduino Uno + AccelStepper is approx 4000 steps/sec.

// FOR 1/1 STEPPING (Full Step):
// 200 steps = 1 revolution. 
// 2000 steps/sec = 10 revs/sec = 600 RPM (Fast)
#define SPEED_DEFAULT 2000   
#define ACCEL_DEFAULT 1000    

// FOR 1/16 STEPPING:
// 3200 steps = 1 revolution.
// 4000 steps/sec = 1.25 revs/sec = 75 RPM (Slow)
// #define SPEED_DEFAULT 4000
// #define ACCEL_DEFAULT 2000

const int NUM_STEPPERS = 4;
const char* AXIS_NAMES[] = { "X", "Y", "Z", "A" };

unsigned long lastCommandTime = 0;
const unsigned long TIMEOUT_MS = 600000; 
bool motorsEnabled = false; 
bool inverted[4] = {false, false, false, false}; 

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
  Serial.begin(115200); 

  pinMode(X_STEP_PIN, OUTPUT); pinMode(X_DIR_PIN, OUTPUT);
  pinMode(Y_STEP_PIN, OUTPUT); pinMode(Y_DIR_PIN, OUTPUT);
  pinMode(Z_STEP_PIN, OUTPUT); pinMode(Z_DIR_PIN, OUTPUT);
  pinMode(A_STEP_PIN, OUTPUT); pinMode(A_DIR_PIN, OUTPUT);

  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, HIGH); 
  motorsEnabled = false;
  lastCommandTime = millis();

  if (A_ENABLE_PIN != ENABLE_PIN) {
    pinMode(A_ENABLE_PIN, OUTPUT);
    digitalWrite(A_ENABLE_PIN, HIGH);
  }

  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].setMaxSpeed(SPEED_DEFAULT);
    steppers[i].setAcceleration(ACCEL_DEFAULT);
  }

  Serial.println("Arduino Stepper Controller Ready (Optimized).");
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
  // Run motors as fast as possible
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].run(); 
  }
  
  // Non-blocking Serial Check
  checkSerial(); 

  if (motorsEnabled && (millis() - lastCommandTime > TIMEOUT_MS)) {
    digitalWrite(ENABLE_PIN, HIGH);
    if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, HIGH);
    motorsEnabled = false;
    Serial.println("Timeout: Motors DISABLED.");
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

void waitForMotors() {
  bool moving = true;
  while (moving) {
    moving = false;
    for (int i = 0; i < NUM_STEPPERS; i++) {
      // Optimization: Only call run() if distance remains
      if (steppers[i].distanceToGo() != 0) {
        steppers[i].run();
        moving = true;
      }
    }
  }
}

void processCommand(char* command) {
    lastCommandTime = millis();
    
    // E: Enable
    if (command[0] == 'E') {
      int state = atoi(command + 2);
      if (state == 1) {
        digitalWrite(ENABLE_PIN, LOW);
        if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, LOW);
        motorsEnabled = true;
        Serial.println("Motors ENABLED.");
      } else {
        digitalWrite(ENABLE_PIN, HIGH);
        if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, HIGH);
        motorsEnabled = false;
        Serial.println("Motors DISABLED.");
      }
    }
    // M: Move Absolute
    else if (command[0] == 'M') {
      long s1, s2, s3, s4;
      if (sscanf(command, "M %ld %ld %ld %ld", &s1, &s2, &s3, &s4) == 4) {
        Serial.println("Moving...");
        steppers[0].moveTo(s1);
        steppers[1].moveTo(s2);
        steppers[2].moveTo(s3);
        steppers[3].moveTo(s4);
        waitForMotors();
        Serial.println("Done.");
      }
    }
    // R: Move Relative
    else if (command[0] == 'R') {
      long s1, s2, s3, s4;
      if (sscanf(command, "R %ld %ld %ld %ld", &s1, &s2, &s3, &s4) == 4) {
        Serial.println("Moving Relative...");
        steppers[0].move(s1);
        steppers[1].move(s2);
        steppers[2].move(s3);
        steppers[3].move(s4);
        waitForMotors();
        Serial.println("Done.");
      }
    }
    // I: Info
    else if (command[0] == 'I') {
      Serial.println("Connection Active.");
      Serial.print("Motors: ");
      Serial.println(digitalRead(ENABLE_PIN) == LOW ? "ENABLED" : "DISABLED");
      Serial.print("Inverted: ");
      for(int i=0; i<4; i++) {
        Serial.print(AXIS_NAMES[i]); Serial.print("="); Serial.print(inverted[i] ? "1" : "0");
        if(i<3) Serial.print(" ");
      }
      Serial.println();
      for (int i = 0; i < NUM_STEPPERS; i++) {
        Serial.print(AXIS_NAMES[i]); Serial.print(": pos="); Serial.println(steppers[i].currentPosition());
      }
    }
    // V: Invert
    else if (command[0] == 'V') {
      int axis, state;
      if (sscanf(command, "V %d %d", &axis, &state) == 2) {
        if (axis >= 0 && axis < 4) {
          inverted[axis] = (state == 1);
          steppers[axis].setPinsInverted(inverted[axis], false, false);
          Serial.print("Axis "); Serial.print(AXIS_NAMES[axis]); Serial.println(inverted[axis] ? " Inverted: YES" : " Inverted: NO");
        }
      }
    }
    // S: Speed
    else if (command[0] == 'S') {
      float speed = atof(command + 2);
      if (speed > 0) {
        for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setMaxSpeed(speed);
        Serial.print("Speed set to: "); Serial.println(speed);
      }
    }
    // A: Accel
    else if (command[0] == 'A') {
      float accel = atof(command + 2);
      if (accel > 0) {
        for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setAcceleration(accel);
        Serial.print("Accel set to: "); Serial.println(accel);
      }
    }
    // H: Home
    else if (command[0] == 'H') {
      for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setCurrentPosition(0);
      Serial.println("Homed.");
    }
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