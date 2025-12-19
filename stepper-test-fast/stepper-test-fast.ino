#include <AccelStepper.h>

// Pin Definitions
#define X_STEP_PIN 2
#define X_DIR_PIN 5
#define Y_STEP_PIN 3
#define Y_DIR_PIN 6
#define Z_STEP_PIN 4
#define Z_DIR_PIN 7
#define A_STEP_PIN 12
#define A_DIR_PIN 13
#define ENABLE_PIN 8

// Configuration
// 1/16 microstepping, 35mm spool, 200 steps/rev
// Steps/mm = (200 * 16) / (35 * PI) = 29.10
// 20cm = 200mm = ~5820 steps
const long STEPS_20CM = 5820;

// Max Speed for Arduino Uno with AccelStepper is roughly 4000 steps/sec
// With 4 motors running, effective speed might be lower due to CPU overhead.
#define MAX_SPEED 4000
#define ACCELERATION 2000

AccelStepper steppers[4] = {
  AccelStepper(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, Y_STEP_PIN, Y_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, Z_STEP_PIN, Z_DIR_PIN),
  AccelStepper(AccelStepper::DRIVER, A_STEP_PIN, A_DIR_PIN)
};

void setup() {
  Serial.begin(115200);
  
  // Enable Motors
  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, LOW); 

  // Setup Motors
  for(int i=0; i<4; i++) {
    steppers[i].setMaxSpeed(MAX_SPEED);
    steppers[i].setAcceleration(ACCELERATION);
  }

  Serial.println("=== HIGH SPEED TEST START ===");
  delay(1000);

  // 1. Move UP 20cm (0 -> 5820)
  Serial.println("1. Moving UP 20cm...");
  moveAllTo(STEPS_20CM);
  delay(500);

  // 2. Move DOWN 40cm (5820 -> -5820)
  Serial.println("2. Moving DOWN 40cm...");
  moveAllTo(-STEPS_20CM);
  delay(500);

  // 3. Move UP 20cm (Back to 0)
  Serial.println("3. Moving UP 20cm (Return to Start)...");
  moveAllTo(0);

  Serial.println("=== TEST COMPLETE ===");
  digitalWrite(ENABLE_PIN, HIGH); // Disable motors
}

void loop() {
  // Do nothing
}

void moveAllTo(long absolutePos) {
  for(int i=0; i<4; i++) {
    steppers[i].moveTo(absolutePos);
  }

  bool moving = true;
  while (moving) {
    moving = false;
    for(int i=0; i<4; i++) {
      // Calling run() as frequently as possible is key for speed
      if (steppers[i].distanceToGo() != 0) {
        steppers[i].run();
        moving = true;
      }
    }
  }
}
