# Project Context: CNC Shield Controller

## Overview
A web-based interface for controlling a 4-axis CNC Shield v3 stepper motor setup using an Arduino Uno R4. The project enables real-time motor control, choreography recording/playback, and parameter tuning via a browser.

## Tech Stack
- **Frontend:** HTML5, CSS3, JavaScript (WebSocket client)
- **Backend:** Node.js, Express, `ws` (WebSocket), `serialport`
- **Firmware:** Arduino (C++), `AccelStepper` library, optimized for Arduino Uno R4
- **Communication:** Serial (115200 baud) for Arduino <-> Node.js, WebSocket for Browser <-> Node.js

## Hardware Configuration
- **Controller:** Arduino Uno R4 (Minima/WiFi)
- **Shield:** CNC Shield v3
- **Drivers:** 4x Stepper Drivers (A4988/DRV8825)
- **Motors:** 4x NEMA 17 Stepper Motors (Axes: X, Y, Z, A)

## Feature Status

### Core Motion Control
- [x] Independent control of 4 stepper motors (X, Y, Z, A)
- [x] Absolute and Relative positioning
- [x] Dynamic Speed and Acceleration configuration
- [x] Homing (Set Current Position as Zero)
- [x] Motor Direction Inversion
- [x] Emergency Stop / Motor Rest (Disable Torque)
    - *Update:* Replaced momentary button with a toggle switch (Green/Red) for intuitive Enable/Disable state (Commands: `E1`/`E0`).

### Advanced Features
- [x] Choreography Recording & Playback (Supports Speed/Accel changes per keyframe)
- [x] Real-time position feedback

## Development Plan & Roadmap

### Active Tasks
- [ ] Maintenance and bug fixing.
- [ ] Documentation improvements (wiring diagrams, setup guide).

### Completed
- [x] Initial Firmware Implementation (`CNCshield.ino`)
- [x] Node.js Serial/WebSocket Server (`server.js`)
- [x] Web Frontend Interface (`index.html`, `app.js`)
- [x] Feature: Motor Enable/Disable Toggle Switch
- [x] Feature: Smooth Visual Interpolation (Animation) for motor movements.
- [x] Fix: Corrected inverted Altitude Readout logic.

## Architecture Notes
- The Arduino firmware uses non-blocking `AccelStepper` calls to manage 4 motors simultaneously.
- The Node.js server acts as a bridge, parsing WebSocket messages from the UI and forwarding G-code-like commands to the Arduino via Serial.
- **UI Logic:** The frontend now uses a `requestAnimationFrame` loop to smoothly interpolate visual motor positions towards the commanded targets, simulating the acceleration and speed of the physical motors for a realistic display.

## Performance Tuning
**Motors moving too slow?**
The `AccelStepper` library on Arduino Uno R4 hits a software speed limit around ~20,000 steps/sec total across all axes.
To increase physical speed without hitting this CPU limit, **reduce microstepping** by removing jumpers on the CNC Shield (under the drivers).

**Jumper Config (Speed vs Smoothness):**
- **1/16 Step (All 3 Jumpers):** High resolution, very smooth, but slow (Max ~300mm/s).
- **1/4 Step (Middle Jumper Only):** **Recommended.** Good balance. 4x faster than 1/16.
- **Full Step (No Jumpers):** Maximum speed, but noisy and rough.

*Note: If you change microstepping, remember to update `stepsPerMm` in your configuration.*