# CNCshield

Arduino stepper motor controller for CNC shield with 4-axis support.

## Hardware

- Arduino with CNC shield
- 4x stepper drivers
- 17HE15-1504S motors (200 steps/rev)
- Enable pin: 8

## Setup

1. Install AccelStepper library
2. Upload `CNCshield.ino` to Arduino
3. Connect via serial at 115200 baud

## Commands

```
M <s1> <s2> <s3> <s4>  Move to absolute positions
S <speed>              Set max speed (steps/sec)
A <accel>              Set acceleration (steps/sec²)
H                      Home (zero all positions)
```

Examples:
H
M 100 0 0 0



## Testing

Run `stepper_test.py` to execute a movement sequence on Y-axis.

Update `SERIAL_PORT` in the script to match your device.
