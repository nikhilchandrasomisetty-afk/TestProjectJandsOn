'use strict';

const state = { log: [] };

const THUMB_MAX_DIM = 96;
const THUMB_RETENTION = 20;
const LOG_MAX_ENTRIES = 60;

/* ---------- storage ---------- */
async function loadLog() {
  try {
    const r = localStorage.getItem('lifecoach:log');
    state.log = r ? JSON.parse(r) : [];
  } catch (e) {
    state.log = [];
  }
}

async function saveEntry(entry) {
  state.log.unshift(entry);
  state.log = state.log.slice(0, LOG_MAX_ENTRIES);
  // thumbnails are heavy — keep them only on the 20 most recent entries
  state.log.forEach((e, i) => { if (i >= THUMB_RETENTION && e.thumb) delete e.thumb; });
  try {
    localStorage.setItem('lifecoach:log', JSON.stringify(state.log));
  } catch (e) {
    console.warn("Storage full or unavailable", e);
  }
}

function deleteEntry(id) {
  state.log = state.log.filter(e => e.id !== id);
  try {
    localStorage.setItem('lifecoach:log', JSON.stringify(state.log));
  } catch (e) {
    console.warn("Storage full or unavailable", e);
  }
}

/* ---------- thumbnail ---------- */
function fileToThumbnail(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => { img.src = reader.result; };
    img.onerror = () => reject(new Error('Could not load image'));
    img.onload = () => {
      const scale = Math.min(1, THUMB_MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- rendering ---------- */
function formatTimestamp(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function render() {
  const list = document.getElementById('log-list');
  const emptyState = document.getElementById('empty-state');

  list.innerHTML = '';
  emptyState.hidden = state.log.length > 0;

  for (const entry of state.log) {
    const li = document.createElement('li');
    li.className = 'log-entry';

    if (entry.thumb) {
      const img = document.createElement('img');
      img.className = 'log-entry-thumb';
      img.src = entry.thumb;
      img.alt = '';
      li.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'log-entry-body';

    const meta = document.createElement('div');
    meta.className = 'log-entry-meta';
    meta.textContent = [entry.mood, formatTimestamp(entry.timestamp)].filter(Boolean).join(' · ');
    body.appendChild(meta);

    const text = document.createElement('p');
    text.className = 'log-entry-text';
    text.textContent = entry.text;
    body.appendChild(text);

    li.appendChild(body);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'log-entry-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      deleteEntry(entry.id);
      render();
    });
    li.appendChild(del);

    list.appendChild(li);
  }
}

/* ---------- init ---------- */
function init() {
  const form = document.getElementById('entry-form');
  const textInput = document.getElementById('entry-text');
  const moodInput = document.getElementById('entry-mood');
  const photoInput = document.getElementById('entry-photo');
  const photoPreview = document.getElementById('photo-preview');
  const clearButton = document.getElementById('clear-log');

  let pendingThumb = null;

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    try {
      pendingThumb = await fileToThumbnail(file);
      photoPreview.src = pendingThumb;
      photoPreview.hidden = false;
    } catch (e) {
      console.warn('Could not process photo', e);
      pendingThumb = null;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      text,
      mood: moodInput.value || undefined,
      thumb: pendingThumb || undefined,
    };

    await saveEntry(entry);
    render();

    form.reset();
    photoPreview.hidden = true;
    photoPreview.src = '';
    pendingThumb = null;
  });

  clearButton.addEventListener('click', async () => {
    if (!state.log.length) return;
    if (!confirm('Clear all log entries? This cannot be undone.')) return;
    state.log = [];
    try {
      localStorage.removeItem('lifecoach:log');
    } catch (e) {
      console.warn('Storage unavailable', e);
    }
    render();
  });

  loadLog().then(render);
}

document.addEventListener('DOMContentLoaded', init);
