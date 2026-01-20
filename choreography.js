import { state } from './state.js';
import { sendCommand, playServerAudio, pauseServerAudio, seekServerAudio, setServerAudioSpeed } from './comms.js';
import { VBOX_CONFIG } from './config.js';

let playbackInterval = null;

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
  if (state.choreography.length === 0) return;

  if (state.isPlaying) {
    stopChoreography(callbacks);
    return;
  }

  state.isPlaying = true;
  callbacks.onPlayStateChange(true);

  // Use server audio if available, otherwise fall back to local
  const hasServerAudio = state.serverAudioLoaded;
  const audio = document.getElementById('choreoAudio');
  const hasLocalAudio = audio && audio.src && !hasServerAudio;

  if (hasServerAudio) {
    playServerAudio(state.currentTime, state.playbackSpeed);
  } else if (hasLocalAudio) {
    audio.currentTime = state.currentTime;
    audio.play().catch(e => console.error("Audio play error", e));
  } else {
    state.playbackStartTime = Date.now() - (state.currentTime * 1000 / state.playbackSpeed);
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
    if (hasServerAudio) {
      // Server audio time is synced via WebSocket (state.serverAudioTime)
      // But we also track locally for smoother updates
      if (state.serverAudioPlaying) {
        state.currentTime = state.serverAudioTime;
      }
      setServerAudioSpeed(state.playbackSpeed);
    } else if (hasLocalAudio) {
      if (Math.abs(audio.playbackRate - state.playbackSpeed) > 0.01) {
        audio.playbackRate = state.playbackSpeed;
      }
      state.currentTime = audio.currentTime;
    } else {
      state.currentTime = ((Date.now() - state.playbackStartTime) / 1000) * state.playbackSpeed;
    }

    callbacks.onTimeUpdate(state.currentTime);

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

    // Check if playback ended
    if (hasServerAudio && !state.serverAudioPlaying && state.currentTime > 1 && !shouldLoop) {
      stopChoreography(callbacks);
      return;
    }
    if (hasLocalAudio && audio.ended && !shouldLoop) {
      stopChoreography(callbacks);
      return;
    }
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
