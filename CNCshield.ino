/*
 * CNC Shield v3 - 4 Axis Stepper Controller
 * * MODIFIED: Starts with motors DISABLED to prevent USB crash from EMI noise.
 * Type 'E 1' to enable motors.
 */

#include <AccelStepper.h>

// Pin definitions for CNC Shield v3
#define X_STEP_PIN 2
#define X_DIR_PIN 5
#define Y_STEP_PIN 3
#define Y_DIR_PIN 6
#define Z_STEP_PIN 4
#define Z_DIR_PIN 7
#define A_STEP_PIN 12
#define A_DIR_PIN 13
#define ENABLE_PIN 8    // Controls X, Y, Z
#define A_ENABLE_PIN 8  // A-axis enable

// Default motor parameters
#define SPEED_DEFAULT 2000
#define ACCEL_DEFAULT 1000

const int NUM_STEPPERS = 4;
const char* AXIS_NAMES[] = { "X", "Y", "Z", "A" };

AccelStepper steppers[NUM_STEPPERS] = {
  AccelStepper(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, Y_STEP_PIN, Y_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, Z_STEP_PIN, Z_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, A_STEP_PIN, A_DIR_PIN)
};

void setup() {
  Serial.begin(115200);

  pinMode(X_STEP_PIN, OUTPUT);
  pinMode(X_DIR_PIN, OUTPUT);
  pinMode(Y_STEP_PIN, OUTPUT);
  pinMode(Y_DIR_PIN, OUTPUT);
  pinMode(Z_STEP_PIN, OUTPUT);
  pinMode(Z_DIR_PIN, OUTPUT);
  pinMode(A_STEP_PIN, OUTPUT);
  pinMode(A_DIR_PIN, OUTPUT);

  // --- CRITICAL CHANGE ---
  // START WITH MOTORS DISABLED (HIGH)
  // This prevents electrical noise from crashing the USB connection at startup.
  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, HIGH); 

  if (A_ENABLE_PIN != ENABLE_PIN) {
    pinMode(A_ENABLE_PIN, OUTPUT);
    digitalWrite(A_ENABLE_PIN, HIGH);
  }

  // Set defaults
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].setMaxSpeed(SPEED_DEFAULT);
    steppers[i].setAcceleration(ACCEL_DEFAULT);
  }

  // Invert Y and A
  steppers[0].setPinsInverted(true, false, false);
  steppers[2].setPinsInverted(true, false, false);

  Serial.println("Arduino Stepper Controller Ready.");
  Serial.println("STATUS: Motors are DISABLED (Silent Mode).");
  Serial.println("Type 'E 1' to enable motors (Warning: Noise may occur).");
  Serial.println();
  Serial.println("Commands:");
  Serial.println(" M <x> <y> <z> <a> : Move absolute");
  Serial.println(" R <x> <y> <z> <a> : Move relative");
  Serial.println(" S <speed>         : Set max speed");
  Serial.println(" A <accel>         : Set acceleration");
  Serial.println(" H                 : Home (set 0)");
  Serial.println(" E 1               : Enable Motors (ON)");
  Serial.println(" E 0               : Disable Motors (OFF)");
  Serial.println(" I                 : Info");
}

void loop() {
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].run();
  }
  checkSerial();
}

void waitForMotors() {
  bool moving = true;
  while (moving) {
    moving = false;
    for (int i = 0; i < NUM_STEPPERS; i++) {
      steppers[i].run();
      if (steppers[i].distanceToGo() != 0) {
        moving = true;
      }
    }
  }
}

void checkSerial() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.startsWith("E")) {
      int state = command.substring(1).toInt();
      if (state == 1) {
        digitalWrite(ENABLE_PIN, LOW); // LOW = ON
        if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, LOW);
        Serial.println("Motors ENABLED.");
      } else {
        digitalWrite(ENABLE_PIN, HIGH); // HIGH = OFF
        if (A_ENABLE_PIN != ENABLE_PIN) digitalWrite(A_ENABLE_PIN, HIGH);
        Serial.println("Motors DISABLED.");
      }
    }
    else if (command.startsWith("M")) {
      long s1, s2, s3, s4;
      if (sscanf(command.c_str(), "M %ld %ld %ld %ld", &s1, &s2, &s3, &s4) == 4) {
        Serial.println("Moving...");
        steppers[0].moveTo(s1);
        steppers[1].moveTo(s2);
        steppers[2].moveTo(s3);
        steppers[3].moveTo(s4);
        waitForMotors();
        Serial.println("Done.");
      }
    }
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
    else if (command.startsWith("I")) {
      Serial.println("Connection Active.");
      Serial.print("Motors: ");
      if (digitalRead(ENABLE_PIN) == LOW) {
        Serial.println("ENABLED");
      } else {
        Serial.println("DISABLED");
      }
      Serial.print("X Pos: "); Serial.println(steppers[0].currentPosition());
    }
    else if (command.startsWith("S")) {
      float speed = command.substring(1).toFloat();
      if (speed > 0) {
        for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setMaxSpeed(speed);
        Serial.print("Speed set to: "); Serial.println(speed);
      }
    }
    else if (command.startsWith("A")) {
      float accel = command.substring(1).toFloat();
      if (accel > 0) {
        for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setAcceleration(accel);
        Serial.print("Accel set to: "); Serial.println(accel);
      }
    }
    else if (command.startsWith("H")) {
      for (int i = 0; i < NUM_STEPPERS; i++) steppers[i].setCurrentPosition(0);
      Serial.println("Homed (All positions set to 0).");
    }
  }
}