import { state } from './state.js';

export function updateTimeline(callbacks) {
  const timeline = document.querySelector('.timeline');
  const track = document.querySelector('.timeline-track');
  const markers = track.querySelectorAll('.keyframe-marker:not(.playhead)');
  markers.forEach(m => m.remove());
  
  const PPS = 20; 
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
    
    marker.style.left = `${kf.time * PPS}px`;
    marker.title = `${kf.time.toFixed(2)}s`;
    
    marker.onmousedown = (e) => {
        e.stopPropagation();
        if(callbacks.onKeyframeDragStart) callbacks.onKeyframeDragStart(index);
    };
    
    track.appendChild(marker);
  });
}

export function updatePlayhead(time) {
  const track = document.querySelector('.timeline-track');
  if(!track) {
    console.warn('[UI] updatePlayhead: No timeline track found!');
    return;
  }
  
  let playhead = track.querySelector('.playhead');
  if (!playhead) {
    console.log('[UI] Creating playhead element');
    playhead = document.createElement('div');
    playhead.className = 'playhead';
    track.appendChild(playhead);
  }
  
  const PPS = 20; 
  playhead.style.left = `${time * PPS}px`;
  
  const timeDisp = document.getElementById('timeDisplay');
  if(timeDisp) timeDisp.textContent = `${time.toFixed(2)}s`;
}

export function updateKeyframesList(callbacks) {
  const list = document.getElementById('keyframesList');
  list.innerHTML = '';
  
  state.choreography.forEach((kf, index) => {
    const item = document.createElement('div');
    item.className = 'keyframe-item';
    const spd = kf.speed !== undefined ? (kf.speed/1000) + 'k' : 'def';
    const acc = kf.accel !== undefined ? (kf.accel/1000) + 'k' : 'def';
    
    if (index === state.selectedKeyframeIndex) {
        item.style.border = '2px solid var(--accent)';
        item.style.backgroundColor = '#e6f2ff';
    } else {
        item.style.border = 'none';
        item.style.backgroundColor = 'var(--bg-alt)';
    }

    item.innerHTML = `
      <button class="btn-delete" style="margin-right: 10px;">Del</button>
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
