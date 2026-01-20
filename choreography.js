import { state } from './state.js';
import { sendCommand, playServerAudio, pauseServerAudio, seekServerAudio, setServerAudioSpeed } from './comms.js';
import { VBOX_CONFIG } from './config.js';

let playbackInterval = null;
let lastSentSpeed = null; // Track last speed to avoid spamming

// Helper for conditional debug logging
const debugLog = (...args) => { if (state.debugMode) console.log(...args); };

function applyMapping(logicalSteps) {
  const physicalSteps = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const driverIndex = state.motorMapping[i];
    let s = logicalSteps[i];
    if (state.reverseFlags[i]) s = -s;
    physicalSteps[driverIndex] = s;
  }
  return physicalSteps;
}

export function playChoreography(callbacks) {
  debugLog('[Choreo] playChoreography called', {
    hasKeyframes: state.choreography.length,
    isPlaying: state.isPlaying,
    serverAudioLoaded: state.serverAudioLoaded,
    currentTime: state.currentTime
  });

  // Allow playback with just audio (no keyframes required for scrubbing/preview)
  if (state.choreography.length === 0 && !state.serverAudioLoaded) {
    debugLog('[Choreo] No keyframes and no audio - nothing to play');
    return;
  }

  if (state.isPlaying) {
    debugLog('[Choreo] Already playing, stopping...');
    stopChoreography(callbacks);
    return;
  }

  state.isPlaying = true;
  callbacks.onPlayStateChange(true);

  // Use server audio if available, otherwise fall back to local
  const hasServerAudio = state.serverAudioLoaded;
  const audio = document.getElementById('choreoAudio');
  const hasLocalAudio = audio && audio.src && !hasServerAudio;

  debugLog('[Choreo] Audio state:', { hasServerAudio, hasLocalAudio });

  // Always set playbackStartTime for local time tracking (fallback)
  state.playbackStartTime = Date.now() - (state.currentTime * 1000 / state.playbackSpeed);

  if (hasServerAudio) {
    console.log('[Choreo] >>> SENDING PLAY COMMAND to server audio at time:', state.currentTime, 'speed:', state.playbackSpeed);
    playServerAudio(state.currentTime, state.playbackSpeed);
    lastSentSpeed = state.playbackSpeed;
  } else if (hasLocalAudio) {
    audio.currentTime = state.currentTime;
    audio.play().catch(e => console.error("Audio play error", e));
  } else {
    debugLog('[Choreo] No audio, using manual time tracking');
  }

  // Find next keyframe
  let keyframeIndex = 0;
  while (keyframeIndex < state.choreography.length && state.choreography[keyframeIndex].time <= state.currentTime) {
    keyframeIndex++;
  }

  playbackInterval = setInterval(() => {
    const timeDisp = document.getElementById('timeDisplay');

    // Handle Rest State
    if (state.isResting) {
      const elapsedRest = Date.now() - state.restStartTime;
      const totalRest = state.restDuration * 60 * 1000;

      if (elapsedRest >= totalRest) {
        // Wake up
        state.isResting = false;
        sendCommand('E 1'); // Enable motors
        if (timeDisp) timeDisp.classList.remove('resting');

        // Restart
        state.currentTime = 0;
        state.playbackStartTime = Date.now();
        keyframeIndex = 0;

        if (hasServerAudio) {
          playServerAudio(0, state.playbackSpeed);
        } else if (hasLocalAudio) {
          audio.currentTime = 0;
          audio.play().catch(e => console.error("Audio play error", e));
        }
        callbacks.onTimeUpdate(0);
      } else {
        // Update UI with countdown
        const remaining = Math.ceil((totalRest - elapsedRest) / 1000);
        if (timeDisp) {
          timeDisp.textContent = `Rest: ${remaining}s`;
          timeDisp.classList.add('resting');
        }
      }
      return;
    }

    // Update Time
    let timeUpdated = false;
    if (hasServerAudio) {
      // Always use local time calculation for smooth playhead movement
      // Server audio time is only used for occasional sync corrections
      state.currentTime = ((Date.now() - state.playbackStartTime) / 1000) * state.playbackSpeed;
      timeUpdated = true;
      
      // Only send speed update if it changed
      if (lastSentSpeed !== state.playbackSpeed) {
        setServerAudioSpeed(state.playbackSpeed);
        lastSentSpeed = state.playbackSpeed;
      }
    } else if (hasLocalAudio) {
      if (Math.abs(audio.playbackRate - state.playbackSpeed) > 0.01) {
        audio.playbackRate = state.playbackSpeed;
      }
      state.currentTime = audio.currentTime;
      timeUpdated = true;
    } else {
      state.currentTime = ((Date.now() - state.playbackStartTime) / 1000) * state.playbackSpeed;
      timeUpdated = true;
    }

    if (timeUpdated) {
      callbacks.onTimeUpdate(state.currentTime);
      // Debug log every second (not every 20ms)
      if (Math.floor(state.currentTime) !== Math.floor(state.currentTime - 0.02)) {
        debugLog('[Choreo] Time update:', state.currentTime.toFixed(2), 'serverAudioPlaying:', state.serverAudioPlaying);
      }
    }

    // Execute Keyframes
    while (keyframeIndex < state.choreography.length &&
      state.choreography[keyframeIndex].time <= state.currentTime) {

      const kf = state.choreography[keyframeIndex];

      if (kf.speed !== undefined && kf.speed !== state.uiMaxSpeed) {
        state.uiMaxSpeed = kf.speed;
        callbacks.onSettingsUpdate(kf.speed, null);
        sendCommand(`S ${state.uiMaxSpeed}`);
      }
      if (kf.accel !== undefined && kf.accel !== state.uiAcceleration) {
        state.uiAcceleration = kf.accel;
        callbacks.onSettingsUpdate(null, kf.accel);
        sendCommand(`A ${state.uiAcceleration}`);
      }

      state.currentPositions = [...kf.positions];
      const physicalSteps = applyMapping(state.currentPositions);
      sendCommand(`M ${physicalSteps.join(' ')}`);
      callbacks.onPositionUpdate(); // Trigger visual update

      keyframeIndex++;
    }

    // Check Loop (Prioritize Choreography)
    const lastTime = state.choreography.length > 0 ? state.choreography[state.choreography.length - 1].time : 0;
    const shouldLoop = document.getElementById('loopChoreography').checked; // Still reading DOM here, maybe pass in state?

    if (shouldLoop && state.currentTime > lastTime + 0.5) {
      if (state.restEnabled) {
        state.isResting = true;
        state.restStartTime = Date.now();
        sendCommand('E 0'); // Disable motors
        if (hasServerAudio) pauseServerAudio();
        return;
      }

      state.currentTime = 0;
      state.playbackStartTime = Date.now();
      keyframeIndex = 0;

      if (hasServerAudio) {
        seekServerAudio(0);
        playServerAudio(0, state.playbackSpeed);
      } else if (hasLocalAudio) {
        audio.currentTime = 0;
        if (audio.paused) audio.play();
      }
      callbacks.onTimeUpdate(0);
      return;
    }

    // Check if playback ended - only stop if we're past the last keyframe AND audio isn't playing
    // Don't auto-stop just because server audio stopped - we can still play keyframes based on local time
    const lastKfTime = state.choreography.length > 0 ? state.choreography[state.choreography.length - 1].time : 0;
    const pastAllKeyframes = state.currentTime > lastKfTime + 1;
    
    if (hasLocalAudio && audio.ended && pastAllKeyframes && !shouldLoop) {
      debugLog('[Choreo] Stopping: local audio ended and past all keyframes');
      stopChoreography(callbacks);
      return;
    }
    // For server audio or no audio - don't auto-stop, let it keep running for recording
    // User can stop manually with Stop button
  }, 20);
}

export function stopChoreography(callbacks) {
  state.isPlaying = false;
  state.isResting = false;
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }

  // Stop server audio
  if (state.serverAudioLoaded) {
    pauseServerAudio();
  }

  // Stop local audio
  const audio = document.getElementById('choreoAudio');
  if (audio) audio.pause();

  // Remove resting indicator
  const timeDisp = document.getElementById('timeDisplay');
  if (timeDisp) timeDisp.classList.remove('resting');

  if (callbacks && callbacks.onPlayStateChange) callbacks.onPlayStateChange(false);
  if (callbacks && callbacks.onTimeUpdate) callbacks.onTimeUpdate(state.currentTime);
}

export function recordKeyframe(callbacks) {
  const time = state.currentTime;

  // Need current box state. 
  // Ideally this is passed in or in state.
  // For now we assume state.boxState exists?
  // I didn't add boxState to state.js yet. I should.
  // I'll grab it from app.js via callback or just use a placeholder for now.

  // Actually, let's defer recording logic to app.js which knows about boxState, 
  // OR we add boxState to state.js.
  // I'll add boxState to state.js in a moment.
}
