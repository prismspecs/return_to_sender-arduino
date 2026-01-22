import { state } from './state.js';

// Helper for conditional debug logging
const debugLog = (...args) => { if (state.debugMode) console.log(...args); };

export function updateTimeline(callbacks) {
  const timeline = document.querySelector('.timeline');
  const track = document.querySelector('.timeline-track');
  const markers = track.querySelectorAll('.keyframe-marker:not(.playhead)');
  markers.forEach(m => m.remove());

  const PPS = state.timelineZoom || 20;
  const maxKeyframeTime = state.choreography.length > 0 ? Math.max(...state.choreography.map(kf => kf.time)) : 0;
  const setDuration = state.timelineDuration || 0;

  // Use the greater of: set duration, max keyframe time, or current time
  const timeToDisplay = Math.max(maxKeyframeTime, state.currentTime, setDuration);
  const requiredWidth = timeToDisplay * PPS + 200;
  const containerWidth = timeline.clientWidth;

  track.style.width = `${Math.max(containerWidth, requiredWidth)}px`;

  if (state.choreography.length === 0) return;

  state.choreography.forEach((kf, index) => {
    const marker = document.createElement('div');
    marker.className = 'keyframe-marker';
    if (index === state.selectedKeyframeIndex) {
      marker.classList.add('selected');
    }

    const markerWidth = Math.max(2, Math.min(8, PPS * 0.4));
    marker.style.width = `${markerWidth}px`;
    marker.style.left = `${kf.time * PPS}px`;
    marker.title = `${kf.time.toFixed(2)}s`;

    marker.onmousedown = (e) => {
      e.stopPropagation();
      if (callbacks.onKeyframeDragStart) callbacks.onKeyframeDragStart(index);
    };

    track.appendChild(marker);
  });
}

export function updatePlayhead(time) {
  const track = document.querySelector('.timeline-track');
  if (!track) {
    debugLog('[UI] updatePlayhead: No timeline track found!');
    return;
  }

  let playhead = track.querySelector('.playhead');
  if (!playhead) {
    debugLog('[UI] Creating playhead element');
    playhead = document.createElement('div');
    playhead.className = 'playhead';
    track.appendChild(playhead);
  }

  const PPS = state.timelineZoom || 20;
  playhead.style.left = `${time * PPS}px`;

  const timeDisp = document.getElementById('timeDisplay');
  if (timeDisp) timeDisp.textContent = `${time.toFixed(2)}s`;
}

export function updateKeyframesList(callbacks) {
  const list = document.getElementById('keyframesList');
  list.innerHTML = '';

  state.choreography.forEach((kf, index) => {
    const item = document.createElement('div');
    item.className = 'keyframe-item';
    
    // Validation check for Speed/Accel
    const isInvalid = (val) => val === null || val === undefined || isNaN(val);
    const speedInvalid = isInvalid(kf.speed);
    const accelInvalid = isInvalid(kf.accel);
    const hasError = speedInvalid || accelInvalid;
    
    const spd = !speedInvalid ? (kf.speed / 1000) + 'k' : 'NULL';
    const acc = !accelInvalid ? (kf.accel / 1000) + 'k' : 'NULL';

    if (index === state.selectedKeyframeIndex) {
      item.style.border = '2px solid var(--accent)';
      item.style.backgroundColor = '#e6f2ff';
    } else if (hasError) {
      item.style.border = '1px solid #ffcc00';
      item.style.backgroundColor = '#fff9e6'; // Light yellow warning
    } else {
      item.style.border = 'none';
      item.style.backgroundColor = 'var(--bg-alt)';
    }

    item.innerHTML = `
      <button class="btn-delete" style="margin-right: 10px;">Del</button>
      ${hasError ? '<span title="Invalid Speed or Accel" style="margin-right:5px; cursor:help;">⚠️</span>' : ''}
      <span class="kf-label" style="cursor: pointer; flex-grow: 1;">${kf.time.toFixed(2)}s: [${kf.positions.join(', ')}] <small>(S:${spd} A:${acc})</small></span>
    `;

    item.querySelector('.btn-delete').onclick = () => callbacks.onDelete(index);
    item.querySelector('.kf-label').onclick = () => callbacks.onSelect(index);

    list.appendChild(item);
  });
}

export function updateFileNameDisplay() {
  const el = document.getElementById('fileNameDisplay');
  if (el) el.textContent = `(${state.currentFileName})`;
}
