# Project Context: CNC Shield Controller

## Overview
A web-based interface for controlling a 4-axis CNC Shield v3 stepper motor setup using an Arduino Uno R4. The project enables real-time motor control, choreography recording/playback, and parameter tuning via a browser.

## Tech Stack
- **Frontend:** HTML5, CSS3, JavaScript (ES6 Modules)
    - `app.js`: Main controller.
    - `comms.js`: WebSocket communication.
    - `state.js`: Global state management.
    - `ui.js`: DOM updates (Timeline, Lists).
    - `choreography.js`: Playback loop and logic.
    - `storage.js`: LocalStorage & IndexedDB.
    - `kinematics.js`: Geometry math.
- **Backend:** Node.js, Express, `ws` (WebSocket), `serialport`
- **Firmware:** Arduino (C++), `AccelStepper` library, optimized for Arduino Uno R4
- **Communication:** Serial (115200 baud) for Arduino <-> Node.js, WebSocket for Browser <-> Node.js

## Hardware Configuration
- **Controller:** Arduino Uno R4 (Minima/WiFi)
- **Shield:** CNC Shield v3
- **Drivers:** 4x Stepper Drivers (A4988/DRV8825)
- **Motors:** 4x NEMA 17 Stepper Motors (Axes: X, Y, Z, A)
- **Spool:** 24mm Diameter
- **Microstepping:** 1/8 (configured via jumpers and software)

## Feature Status

### Core Motion Control
- [x] Independent control of 4 stepper motors (X, Y, Z, A)
- [x] Absolute (`M`) and Relative (`R`) positioning
- [x] Dynamic Speed and Acceleration configuration (x1000 scale in UI)
- [x] **Port Selection:** Select Arduino serial port from UI.
- [x] **Set Floor:** Sets current position as Zero (Hardware & Software).
- [x] **Set Ceiling:** Sets Max Height limit based on current position.
- [x] **STOP:** Immediate deceleration halt (`Q` command).
- [x] Motor Direction Inversion
- [x] Motor Enable/Disable (Auto-homes on disable)

### Advanced Features
- [x] **Choreography:** Record & Playback with Speed/Accel per keyframe.
- [x] **Audio Sync:** Load audio tracks, sync playback, scrub timeline.
- [x] **Project Management:** Quick Save/Load slots in LocalStorage.
- [x] **Visual Editor:** Drag-and-drop keyframes, virtual box pose editing.
- [x] **Infinite Recording:** Playback continues past end for extending sequences.
- [x] **Configuration Export/Import:** Save and load full hardware configuration (Mappings, Limits, Drivers) to JSON.

## Architecture Notes
- **Modular JS:** The frontend is now split into ES6 modules to manage complexity.
- **State Management:** `state.js` acts as the single source of truth.
- **Firmware Protocol:**
    - `M x y z a`: Move Absolute
    - `R x y z a`: Move Relative
    - `Q`: Quick Stop (Decelerate to 0)
    - `E 0/1`: Enable/Disable
    - `H`: Set Home (0)
- **Persistence:**
    - **Choreography:** `localStorage`
    - **Audio:** `IndexedDB` (to handle large binary blobs)
- **API Endpoints:**
    - `GET /api/ports`: List available serial ports.
    - `POST /api/connect`: Connect to a specific port.
    - `POST /api/command`: Send raw command (fallback).

## Performance Tuning
- **Microstepping:** UI allows selecting driver type and jumper config to calculate steps/mm.
- **Speed Limits:** UI caps speed at 30k steps/sec to prevent stalling.
- **Interpolation:** Frontend uses a `requestAnimationFrame` loop with velocity ramping to smooth out visual updates between status polls.

## Maintenance Rules
- **Update Context:** Every time a significant feature is implemented, an architectural change is made, or a major bug is fixed, this file (`GEMINI.md`) MUST be updated to reflect the new technical state of the project. This ensures AI agents and developers always have an accurate source of truth.

