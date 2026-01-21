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

## Recent Changes (2026-01-21)
- **Calibration UI:** Updated to non-sequential "Random Access" mode for easier adjustment.
- **Motor Configuration:** Frame dimensions (Width/Length/Height) now sync to server and persist across devices.
- **Playback Logic:**
    - **Loop & Rest:** Fixed priority logic. Rest Mode now works correctly as a buffer between loops.
    - **Stop & Reset:** Fixed logic to ensure playhead resets to 0 and audio rewinds.
    - **Scrubbing:** Dragging playhead now seeks server playback/audio.
- **Motor Control:**
    - **Inversion:** "Rev" checkboxes now control hardware inversion (`V` command) directly, removing confusing software double-negation.
    - **Slack Fix:** Identified and fixed "slack on roll" issue (user advised to correct Frame Width).
- **UI Tweaks:**
    - Removed unused "Timeline Duration" input.
    - Added "Rest Countdown" display.
    - Keyframe markers thin out when zoomed out.

## Roadmap
- [ ] **Advanced Kinematics:** Improve Inverse Kinematics for complex paths.
- [ ] **3D Visualization:** Add a Three.js view of the box moving in 3D space.
- [ ] **Hardware:** Verify "STOP" command `Q` with new firmware upload.