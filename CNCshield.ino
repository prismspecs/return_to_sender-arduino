/*
 * the 17HE15-1504S is 200 steps per revolution
 * without any jumpers the drivers do not make microsteps
 * otherwise that will factor into the calculation for rotations per mm, etc.
 * the spool is 25mm in diameter or 78.54mm~ in circumference
 * Steps per Meter = (Total Steps per Revolution) / (Circumference in Meters)
 * steps per millimeter = 200 / 78.54 = 2.546473 ...
 * steps per meter = 2546
 * 1528 to move 60cm...
 */

#include <AccelStepper.h>

// Pin definitions
#define X_STEP_PIN          2
#define X_DIR_PIN           5
#define Y_STEP_PIN          3
#define Y_DIR_PIN           6
#define Z_STEP_PIN          4
#define Z_DIR_PIN           7
#define A_STEP_PIN          12
#define A_DIR_PIN           13
#define ENABLE_PIN          8

#define SPEED_DEFAULT       2000
#define ACCEL_DEFAULT       1000

const int NUM_STEPPERS = 4;

AccelStepper steppers[NUM_STEPPERS] = {
  AccelStepper(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, Y_STEP_PIN, Y_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, Z_STEP_PIN, Z_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, A_STEP_PIN, A_DIR_PIN)
};

void setup() {
  Serial.begin(115200);

  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, LOW);

  // Set initial default values
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].setMaxSpeed(SPEED_DEFAULT);      // Default max speed in steps/sec
    steppers[i].setAcceleration(ACCEL_DEFAULT); // Default acceleration in steps/sec^2
  }
  
  Serial.println("Arduino Stepper Controller Ready.");
  Serial.println("Commands:");
  Serial.println(" M <s1> <s2> <s3> <s4> : Move to absolute positions");
  Serial.println(" S <speed>             : Set max speed for all motors");
  Serial.println(" A <accel>             : Set acceleration for all motors");
  Serial.println(" H                     : Home (set current positions to 0)");
}

void loop() {
  // Always run the steppers
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].run();
  }

  // Check for and process new serial commands
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

    // Check the first character of the command
    if (command.startsWith("M")) {
      // Move command
      long s1, s2, s3, s4;
      int parsed = sscanf(command.c_str(), "M %ld %ld %ld %ld", &s1, &s2, &s3, &s4);

      if (parsed == 4) {
        Serial.print("Moving to: ");
        Serial.print(s1); Serial.print(", ");
        Serial.print(s2); Serial.print(", ");
        Serial.print(s3); Serial.print(", ");
        Serial.println(s4);
        
        steppers[0].moveTo(s1);
        steppers[1].moveTo(s2);
        steppers[2].moveTo(s3);
        steppers[3].moveTo(s4);
        
        waitForMotors();
        Serial.println("Move complete.");
      } else {
        Serial.println("Error: Invalid move command.");
      }
    } 
    else if (command.startsWith("S")) {
      float speed = command.substring(1).toFloat();
      if (speed > 0) {
          Serial.print("Setting max speed for all motors to: ");
          Serial.println(speed);
          for (int i = 0; i < NUM_STEPPERS; i++) {
              steppers[i].setMaxSpeed(speed);
          }
      } else {
          Serial.println("Error: Invalid speed command.");
      }
  }

    else if (command.startsWith("A")) {
      // Acceleration setting command
      float accel = command.substring(1).toFloat();
      if (accel > 0) {
        Serial.print("Setting acceleration for all motors to: ");
        Serial.println(accel);
        for (int i = 0; i < NUM_STEPPERS; i++) {
          steppers[i].setAcceleration(accel);
        }
      } else {
        Serial.println("Error: Invalid acceleration command.");
      }
    }
    else if (command.startsWith("H")) {
      // Homing command
      Serial.println("Homing: Setting all positions to 0.");
      for(int i = 0; i < NUM_STEPPERS; i++) {
        steppers[i].setCurrentPosition(0);
      }
    }
  }
}
