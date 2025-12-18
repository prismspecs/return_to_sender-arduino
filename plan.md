# Project Plan

This document outlines the plan for the CNC Shield Controller project.

## Features

- [x] Control 4 stepper motors (X, Y, Z, A) via a web interface.
- [x] Move motors to absolute positions.
- [x] Move motors relative to their current positions.
- [x] Set motor speed and acceleration.
- [x] Home all motors (set current position to 0).
- [x] Reverse motor direction.
- [x] Choreography recording and playback.
- [x] Rest motors (disable motor torque).

## Added Features
- Replaced the motor enable/disable button with a toggle switch for a more intuitive user experience. The switch is green when enabled and red when disabled, sending `E1` and `E0` commands respectively.
