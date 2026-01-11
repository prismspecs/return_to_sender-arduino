# Project Plan: Return to Sender (CNC Shield Interface)

## Overview
Web interface for controlling a 4-axis cable robot using an Arduino CNC Shield.
- **Frontend:** HTML/CSS/JS (Modular ES6)
- **Backend:** Node.js + WebSocket
- **Firmware:** Arduino (AccelStepper based)

## Current Status
- **Modular Codebase:** Refactored monolithic `app.js` into modules (`state`, `comms`, `ui`, `choreography`, `storage`).
- **UI Layout:** Compact two-column layout (Hardware vs. Simulation).
- **Audio:** Fully integrated audio playback with timeline sync and IndexedDB persistence.
- **Project Management:** "Quick Save" system for managing multiple choreographies locally.

## Recent Changes (2026-01-11)
- **Modularization:** Split `app.js` into 7 specialized modules.
- **UI Overhaul:**
    - Two-row choreography toolbar.
    - Compact styles and reduced padding.
    - Restored granular motor controls (-10/+10 buttons).
- **Timeline & Playback:**
    - Draggable Playhead and Keyframes.
    - Infinite playback for recording (loops only if checked).
    - Audio syncs perfectly with scrubbing.
- **Calibration:**
    - **Set Floor:** Resets hardware, visual position, and virtual box state to 0.
    - **Set Ceiling:** Defines max height based on current position.
    - **STOP:** Added emergency halt (Firmware `Q` command) that decelerates motors immediately.
- **Persistence:** Audio file and project data persist across reloads.

## Roadmap
- [ ] **Advanced Kinematics:** Improve Inverse Kinematics for complex paths.
- [ ] **3D Visualization:** Add a Three.js view of the box moving in 3D space.
- [ ] **Hardware:** Verify "STOP" command `Q` with new firmware upload.