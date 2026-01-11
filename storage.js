import { state } from './state.js';
import { AXIS_NAMES } from './config.js';

// IndexedDB Helper
const DB_NAME = 'ChoreoAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'audioFiles';

function openAudioDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveAudioToDB(file) {
  try {
    const db = await openAudioDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(file, 'currentTrack'); 
    console.log('Audio saved to local storage');
  } catch (e) {
    console.error("Error saving audio to DB", e);
  }
}

export async function loadAudioFromDB(callbacks) {
  try {
    const db = await openAudioDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get('currentTrack');
    
    request.onsuccess = () => {
      const file = request.result;
      if (file) {
        state.audioFile = file;
        if(callbacks.onAudioLoaded) callbacks.onAudioLoaded(file);
      }
    };
  } catch (e) {
    console.error("Error loading audio from DB", e);
  }
}

export function saveChoreographyToLocal() {
  const data = {
      choreography: state.choreography,
      fileName: state.currentFileName,
      reverseFlags: state.reverseFlags // Save flags too
  };
  localStorage.setItem('choreographyData', JSON.stringify(data));
}

export function loadChoreographyFromLocal(callbacks) {
  const saved = localStorage.getItem('choreographyData');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (Array.isArray(data)) {
          state.choreography = data;
          state.currentFileName = "Untitled";
      } else {
          state.choreography = data.choreography || [];
          state.currentFileName = data.fileName || "Untitled";
          if (data.reverseFlags) state.reverseFlags = data.reverseFlags;
      }
      
      if (callbacks.onLoaded) callbacks.onLoaded();
    } catch (e) {
      console.error("Error loading choreography", e);
    }
  }
}

export function refreshQuickSaveList(onUpdate) {
  const projects = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('project_')) {
      projects.push(key.replace('project_', ''));
    }
  }
  projects.sort();
  onUpdate(projects);
}

export function quickSave() {
  let name = prompt("Enter project name:", state.currentFileName !== "Untitled" ? state.currentFileName : "");
  if (!name) return null;
  
  name = name.trim();
  const key = `project_${name}`;
  
  const data = {
    version: '1.0',
    choreography: state.choreography,
    reverseFlags: state.reverseFlags,
    fileName: name
  };
  
  localStorage.setItem(key, JSON.stringify(data));
  state.currentFileName = name;
  saveChoreographyToLocal(); // Update working copy
  
  return name;
}

export function quickLoad(name, callbacks) {
  const key = `project_${name}`;
  const saved = localStorage.getItem(key);
  
  if (saved) {
    try {
      const data = JSON.parse(saved);
      state.choreography = data.choreography || [];
      if (data.reverseFlags) {
        state.reverseFlags = data.reverseFlags;
      }
      state.currentFileName = name;
      
      saveChoreographyToLocal();
      if(callbacks.onLoaded) callbacks.onLoaded();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
  return false;
}

export function quickDelete(name) {
    localStorage.removeItem(`project_${name}`);
}
