# Project Plan: Return to Sender (CNC Shield Interface)

## Overview
Web interface for controlling a 4-axis cable robot using an Arduino CNC Shield.
- **Frontend:** HTML/CSS/JS (Vanilla)
- **Backend:** Node.js + WebSocket (implied by `server.js` presence, though strictly client-side provided so far?)
- **Firmware:** Arduino (AccelStepper based)

## Current Status
- Basic control of 4 motors (Steps/Absolute/Relative).
- Virtual Box kinematics (calculating cable lengths for a target box pose).
- Choreography recording and playback.
- Real-time position feedback (simulated/animated).

## Recent Changes
- **2026-01-09:** Added "Smooth Animation" toggle to UI. 
    - Prevents unnecessary CPU usage/lag by allowing users to disable client-side interpolation.
    - Optimized animation loop to cache speed/acceleration values instead of reading DOM every frame.
    - When animation is disabled, altitude/position readouts update instantly to the commanded target.
