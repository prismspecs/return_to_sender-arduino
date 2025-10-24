/*
 * CNC Shield v3 - 4 Axis Stepper Controller
 * 
 * Motor Specifications:
 * - 17HE15-1504S: 200 steps per revolution
 * - A4988 drivers on whole steps (no microstepping jumpers)
 * - Spool: 25mm diameter = 78.54mm circumference
 * 
 * Calculations:
 * - Steps per mm: 200 / 78.54 = 2.546 steps/mm
 * - Steps per meter: 2546 steps/m
 * - Example: 1528 steps = 60cm of movement
 */

 #include <AccelStepper.h>

 // Pin definitions for CNC Shield v3
 #define X_STEP_PIN          2
 #define X_DIR_PIN           5
 #define Y_STEP_PIN          3
 #define Y_DIR_PIN           6
 #define Z_STEP_PIN          4
 #define Z_DIR_PIN           7
 #define A_STEP_PIN          12
 #define A_DIR_PIN           13
 #define ENABLE_PIN          8  // Controls X, Y, Z
 #define A_ENABLE_PIN        8  // A-axis enable (same as others on most shields)
 
 // Default motor parameters
 #define SPEED_DEFAULT       2000
 #define ACCEL_DEFAULT       1000
 
const int NUM_STEPPERS = 4;
const char* AXIS_NAMES[] = {"X", "Y", "Z", "A"};
 
 AccelStepper steppers[NUM_STEPPERS] = {
   AccelStepper(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN),
   AccelStepper(AccelStepper::DRIVER, Y_STEP_PIN, Y_DIR_PIN),
   AccelStepper(AccelStepper::DRIVER, Z_STEP_PIN, Z_DIR_PIN),
   AccelStepper(AccelStepper::DRIVER, A_STEP_PIN, A_DIR_PIN)
 };
 
 void setup() {
   Serial.begin(115200);
 
   // Configure all stepper pins as outputs explicitly
   pinMode(X_STEP_PIN, OUTPUT);
   pinMode(X_DIR_PIN, OUTPUT);
   pinMode(Y_STEP_PIN, OUTPUT);
   pinMode(Y_DIR_PIN, OUTPUT);
   pinMode(Z_STEP_PIN, OUTPUT);
   pinMode(Z_DIR_PIN, OUTPUT);
   pinMode(A_STEP_PIN, OUTPUT);
   pinMode(A_DIR_PIN, OUTPUT);
   
   // Enable all stepper drivers (active LOW)
   pinMode(ENABLE_PIN, OUTPUT);
   digitalWrite(ENABLE_PIN, LOW);
   
   // If A-axis has separate enable pin, set it too
   if (A_ENABLE_PIN != ENABLE_PIN) {
     pinMode(A_ENABLE_PIN, OUTPUT);
     digitalWrite(A_ENABLE_PIN, LOW);
   }
 
  // Set initial default values
  for (int i = 0; i < NUM_STEPPERS; i++) {
    steppers[i].setMaxSpeed(SPEED_DEFAULT);      // Default max speed in steps/sec
    steppers[i].setAcceleration(ACCEL_DEFAULT); // Default acceleration in steps/sec^2
  }
  
  // Invert direction for Y-axis (1) and A-axis (3)
  steppers[0].setPinsInverted(true, false, false);
  steppers[2].setPinsInverted(true, false, false);
   
  Serial.println("Arduino Stepper Controller Ready.");
  Serial.println("CNC Shield v3 - 4 Axis Configuration (X, Y, Z, A)");
  Serial.println("A4988 drivers - Whole step mode (no microstepping)");
  Serial.println("Direction: X=normal, Y=inverted, Z=normal, A=inverted");
  Serial.println();
  Serial.println("Commands:");
  Serial.println(" M <s1> <s2> <s3> <s4> : Move to absolute positions");
  Serial.println(" S <speed>             : Set max speed for all motors");
  Serial.println(" A <accel>             : Set acceleration for all motors");
  Serial.println(" H                     : Home (set current positions to 0)");
  Serial.println(" T <axis>              : Test individual axis (0=X, 1=Y, 2=Z, 3=A)");
  Serial.println(" I                     : Show status and configuration");
  Serial.println();
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
     else if (command.startsWith("T")) {
       // Test individual axis
       int axis = command.substring(1).toInt();
       if (axis >= 0 && axis < NUM_STEPPERS) {
         Serial.print("Testing axis ");
         Serial.print(AXIS_NAMES[axis]);
         Serial.println(" - moving 200 steps forward and back...");
         
         steppers[axis].setCurrentPosition(0);
         steppers[axis].moveTo(200);
         
         while (steppers[axis].distanceToGo() != 0) {
           steppers[axis].run();
         }
         
         Serial.println("Forward complete, moving back...");
         steppers[axis].moveTo(0);
         
         while (steppers[axis].distanceToGo() != 0) {
           steppers[axis].run();
         }
         
         Serial.println("Test complete.");
       } else {
         Serial.println("Error: Invalid axis. Use 0=X, 1=Y, 2=Z, 3=A");
       }
     }
    else if (command.startsWith("I")) {
       // Info/status command
       Serial.println();
       Serial.println("=== System Status ===");
       Serial.println("Hardware: CNC Shield v3 on Arduino Uno");
       Serial.println("Drivers: A4988 (whole step mode)");
       Serial.println("Motors: 17HE15-1504S (200 steps/rev)");
       Serial.println();
       
       Serial.println("Current Configuration:");
       Serial.print("Max Speed: "); Serial.print(steppers[0].maxSpeed()); Serial.println(" steps/sec");
       Serial.print("Acceleration: "); Serial.print(steppers[0].acceleration()); Serial.println(" steps/sec²");
       Serial.println();
       
      Serial.println("Axis Positions:");
      for (int i = 0; i < NUM_STEPPERS; i++) {
        Serial.print("  ");
        Serial.print(AXIS_NAMES[i]);
        Serial.print(": pos=");
        Serial.print(steppers[i].currentPosition());
        Serial.print(", target=");
        Serial.println(steppers[i].targetPosition());
      }
      Serial.println();
     }
   }
 }
 