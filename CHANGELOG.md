# Changelog - Return to Sender

## [2026-01-19]
### Fixed
- **Reverse Flags:** Resolved issue where stored reverse flags were not consistently applied on page load. Added a synchronization delay (1s) to ensure the Arduino is ready to receive the "Normal" mode override after connection.
- **Kinematics:** Corrected rotation logic. **Pitch** now controls Front/Back Tilt (X-axis rotation) and **Roll** now controls Left/Right Bank (Y-axis rotation).
- **Corner Mapping:** Fixed an issue where Roll/Pitch were affecting the wrong motor pairs.

### Added
- **Numeric Inputs:** Support for direct value entry in Roll and Pitch controls via numeric input fields.
- **Debug Logging:** Added tracing in `app.js` to log hardware synchronization and logical-to-physical motor mapping in the browser console.

### Changed
- **UI Labels:** Updated "Roll" and "Pitch" labels to include descriptions of their physical behavior (Tilt vs Bank).
- **Height Limits:** Standardized system-wide height limit to 2050mm (Rig Height).
