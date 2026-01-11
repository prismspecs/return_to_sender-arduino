import { state } from './state.js';
import { sendCommand } from './comms.js';
import { VBOX_CONFIG } from './config.js';

let playbackInterval = null;

function applyMapping(logicalSteps) {
  const physicalSteps = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const driverIndex = state.motorMapping[i];
    physicalSteps[driverIndex] = logicalSteps[i];
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
  
  const audio = document.getElementById('choreoAudio');
  const hasAudio = audio && audio.src;
  
  if (hasAudio) {
      audio.currentTime = state.currentTime;
      audio.play().catch(e => console.error("Audio play error", e));
  } else {
      state.playbackStartTime = Date.now() - (state.currentTime * 1000 / state.playbackSpeed);
  }
  
  // Find next keyframe
  let keyframeIndex = 0;
  while(keyframeIndex < state.choreography.length && state.choreography[keyframeIndex].time <= state.currentTime) {
      keyframeIndex++;
  }
  
  playbackInterval = setInterval(() => {
    // Update Time
    if (hasAudio) {
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
        state.currentTime = 0;
        state.playbackStartTime = Date.now();
        keyframeIndex = 0;
        
        if (hasAudio) {
            audio.currentTime = 0;
            if (audio.paused) audio.play();
        }
        callbacks.onTimeUpdate(0);
        return;
    }
    
    if (hasAudio && audio.ended && !shouldLoop) {
         stopChoreography(callbacks);
         return;
    }
  }, 20);
}

export function stopChoreography(callbacks) {
  state.isPlaying = false;
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  
  const audio = document.getElementById('choreoAudio');
  if (audio) audio.pause();
  
  if (callbacks && callbacks.onPlayStateChange) callbacks.onPlayStateChange(false);
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
