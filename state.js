import { DEFAULT_MOTOR_MAPPING } from './config.js';

export const state = {
    // Debug mode
    debugMode: true,

    choreography: [],
    currentFileName: "Untitled",
    currentPositions: [0, 0, 0, 0],
    visualPositions: [0, 0, 0, 0],
    motorVelocities: [0, 0, 0, 0],
    reverseFlags: [false, false, false, false],
    motorMapping: [...DEFAULT_MOTOR_MAPPING],

    // Playback State
    isPlaying: false,
    playbackSpeed: 1.0,
    playbackStartTime: 0,
    currentTime: 0,
    selectedKeyframeIndex: -1,
    timelineDuration: 0, // 0 = auto (based on keyframes)

    // Loop & Rest
    restEnabled: false,
    restDuration: 1, // Minutes
    isResting: false,
    restStartTime: 0,

    // Settings
    uiMaxSpeed: 24000,
    uiAcceleration: 24000,
    maxCeiling: 2050,

    // Drag State
    isDraggingPlayhead: false,
    isDraggingKeyframe: false,
    draggedKeyframeIndex: -1,

    // Virtual Box
    boxState: { z: -300, roll: 0, pitch: 0 },
    homeLengths: [0, 0, 0, 0],

    // Audio (local - legacy)
    audioFile: null,

    // Server Audio (plays on Pi)
    serverAudioLoaded: false,
    serverAudioPlaying: false,
    serverAudioTime: 0,
    serverAudioFileName: null
};
