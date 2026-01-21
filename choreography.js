import { state } from './state.js';
import { sendPlayChoreography, sendStopChoreography } from './comms.js';

export function playChoreography(callbacks) {
  // If already playing, stop
  if (state.isPlaying) {
    stopChoreography(callbacks);
    return;
  }
  
  // Otherwise send play command to server
  sendPlayChoreography(state.currentTime, state.playbackSpeed);
}

export function stopChoreography(callbacks) {
  sendStopChoreography();
  
  // Optimistically stop local state? 
  // Server will send 'playState' false shortly.
  // But for responsiveness:
  // state.isPlaying = false; 
  // if (callbacks && callbacks.onPlayStateChange) callbacks.onPlayStateChange(false);
}

export function recordKeyframe(callbacks) {
  // Logic is handled in app.js currently (gathering UI state)
}