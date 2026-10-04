import {
  clearLibrary,
  deleteMedia,
  getAllMedia,
  getPlaylist,
  getSettings,
  onRemote,
  putMedia,
  savePlaylist,
  saveSettings,
} from './db.js';
import { createSampleMedia } from './samples.js';
import { fetchWeather, formatPlace, reversePlace, searchPlaces, weatherIcon } from './weather.js';

const list = document.getElementById('list');
const status = document.getElementById('save-status');
const count = document.getElementById('playlist-count');
const storageUse = document.getElementById('storage-use');
const clearAll = document.getElementById('clear-all');
const placeResults = document.getElementById('place-results');
const placeCard = document.getElementById('place-card');

const state = {
  media: new Map(),
  items: [],
  settings: null,
  thumbs: new Map(),
  nowPlayingId: null,
};

let chain = Promise.resolve();
let busy = false;
let blockDrag = false;
let lastResults = [];
let toastTimer = 0;

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
}

function toast(message) {
  let node = document.getElementById('toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    node.className = 'toast';
    node.setAttribute('role', 'status');
    document.body.append(node);
  }
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function classify(file) {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type === 'image/svg+xml' || name.endsWith('.svg')) return null;
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(name)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'video/mp4' || name.endsWith('.mp4')) return 'video';
  return null;
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function makeImageThumb(blob) {
  return createImageBitmap(blob).then(async (bitmap) => {
    const scale = Math.min(320 / bitmap.width, 180 / bitmap.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  });
}

function makeVideoThumb(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:-2000px;width:320px;height:180px;opacity:0;pointer-events:none';
    document.body.append(video);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      resolve(value);
    };
    const draw = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext('2d');
        context.fillStyle = '#111';
        context.fillRect(0, 0, 320, 180);
        context.drawImage(video, 0, 0, 320, 180);
        canvas.toBlob((result) => finish(result), 'image/jpeg', 0.8);
      } catch {
        finish(null);
      }
    };
    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener('loadeddata', () => {
      const target = Number.isFinite(video.duration) ? Math.min(0.4, Math.max(video.duration / 2, 0)) : 0;
      if (target > 0.05) video.currentTime = target;
      else draw();
    }, { once: true });
    video.addEventListener('seeked', () => draw(), { once: true });
    video.src = url;
  });
}

async function makeThumb(blob, kind) {
  try {
    if (kind === 'image') return await makeImageThumb(blob);
    if (kind === 'video') return await withTimeout(makeVideoThumb(blob), 5000);
  } catch (error) {
    console.warn(error);
  }
  return null;
}

function thumbUrl(media) {
  if (!media?.thumb) return '';
  if (!state.thumbs.has(media.id)) state.thumbs.set(media.id, URL.createObjectURL(media.thumb));
  return state.thumbs.get(media.id);
}

function showPanel(name) {
  const panel = ['playlist', 'display', 'place'].includes(name) ? name : 'playlist';
  document.querySelectorAll('[data-panel-view]').forEach((view) => {
    view.hidden = view.dataset.panelView !== panel;
  });
  document.querySelectorAll('[data-panel]').forEach((button) => {
    button.setAttribute('aria-current', button.dataset.panel === panel ? 'page' : 'false');
  });
  if (location.hash !== `#${panel}`) history.replaceState(null, '', `#${panel}`);
}

function setSwitch(id, on) {
  document.getElementById(id).setAttribute('aria-checked', String(on));
}

function applySettingsToForm() {
  const settings = state.settings;
  const name = document.getElementById('screen-name');
  if (document.activeElement !== name) name.value = settings.screenName;
  setSwitch('toggle-time', settings.showTime);
  setSwitch('toggle-date', settings.showDate);
  setSwitch('toggle-weather', settings.showWeather);
  setSwitch('toggle-sound', settings.sound);
  document.querySelectorAll('[data-hour]').forEach((button) => {
    const hour12 = button.dataset.hour === '12';
    button.setAttribute('aria-checked', String(hour12 === settings.hour12));
  });
  document.querySelectorAll('[data-fit]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.fit === settings.fit));
  });
  document.querySelectorAll('[data-unit]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.unit === settings.units));
  });
  document.querySelectorAll('[data-pos]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.pos === settings.overlay));
  });
  const duration = document.getElementById('default-duration');
  if (document.activeElement !== duration) duration.value = String(settings.defaultDuration);
  const fade = document.getElementById('fade');
  if (document.activeElement !== fade) fade.value = String(settings.transitionMs);
  document.getElementById('fade-label').textContent = settings.transitionMs ? `${settings.transitionMs} ms` : 'None';
}

async function paintStorage() {
  if (!navigator.storage?.estimate) {
    storageUse.textContent = 'Stored in this browser';
    return;
  }
  const { usage = 0 } = await navigator.storage.estimate();
  storageUse.textContent = `${formatBytes(usage)} in this browser`;
}

function renderList() {
  clearAll.disabled = state.items.length === 0;
  count.textContent = state.items.length
    ? `${state.items.length} ${state.items.length === 1 ? 'item' : 'items'} · plays in order, then repeats`
    : 'Nothing queued yet';
  if (!state.items.length) {
    list.innerHTML = '<div class="empty-list"><p>The playlist is empty.</p><p>Add files, or start with the sample slides.</p></div>';
    return;
  }
  list.innerHTML = state.items.map((item, itemIndex) => {
    const media = state.media.get(item.mediaId);
    if (!media) {
      return `<article class="row is-off" data-id="${escapeHtml(item.id)}" role="listitem">
        <span class="grip" aria-hidden="true"></span>
        <div class="thumb thumb-fallback">Missing</div>
        <div class="row-copy"><strong>Missing file</strong></div>
        <div class="row-actions"><button type="button" data-action="delete">Remove</button></div>
      </article>`;
    }
    const url = thumbUrl(media);
    const thumb = url
      ? `<img class="thumb" alt="" src="${escapeHtml(url)}">`
      : `<div class="thumb thumb-fallback kind-${media.kind}">${media.kind === 'pdf' ? 'PDF' : media.kind === 'video' ? 'MP4' : 'IMG'}</div>`;
    const kindLabel = media.kind === 'pdf' ? 'PDF' : media.kind === 'video' ? 'Video' : 'Image';
    let timing = '';
    if (media.kind === 'video') {
      const timed = item.duration > 0;
      timing = `<div class="timing">
        <label><input class="duration-mode" type="radio" name="mode-${escapeHtml(item.id)}" value="full" ${timed ? '' : 'checked'}> Full video</label>
        <label><input class="duration-mode" type="radio" name="mode-${escapeHtml(item.id)}" value="timed" ${timed ? 'checked' : ''}> Seconds</label>
        <input class="duration-input" type="number" min="1" max="3600" value="${timed ? item.duration : state.settings.defaultDuration}" ${timed ? '' : 'disabled'} aria-label="Seconds on screen">
      </div>`;
    } else {
      const label = media.kind === 'pdf' ? 'Seconds per page' : 'Seconds';
      timing = `<label class="timing">${label}<input class="duration-input" type="number" min="1" max="3600" value="${item.duration || state.settings.defaultDuration}" aria-label="${label}"></label>`;
    }
    return `<article class="row ${item.enabled === false ? 'is-off' : ''} ${item.id === state.nowPlayingId ? 'is-playing' : ''}" data-id="${escapeHtml(item.id)}" draggable="true" role="listitem">
      <span class="grip" title="Drag to reorder" aria-hidden="true"></span>
      ${thumb}
      <div class="row-copy">
        <input class="name-input" value="${escapeHtml(media.name)}" aria-label="Media name" maxlength="160">
        <p class="meta"><span class="live">On screen</span>${kindLabel} · ${formatBytes(media.size || media.blob?.size || 0)}</p>
        ${timing}
      </div>
      <div class="row-actions">
        <button type="button" class="switch" data-action="enable" aria-checked="${item.enabled === false ? 'false' : 'true'}" aria-label="Include in the playlist"><i></i></button>
        <button type="button" data-action="up" ${itemIndex === 0 ? 'disabled' : ''} aria-label="Move up">Up</button>
        <button type="button" data-action="down" ${itemIndex === state.items.length - 1 ? 'disabled' : ''} aria-label="Move down">Down</button>
        <button type="button" class="btn-danger" data-action="delete">Delete</button>
      </div>
    </article>`;
  }).join('');
}

async function load() {
  const [media, items, settings] = await Promise.all([getAllMedia(), getPlaylist(), getSettings()]);
  state.media = new Map(media.map((entry) => [entry.id, entry]));
  state.settings = settings;
  const pruned = items.filter((item) => state.media.has(item.mediaId));
  state.items = pruned;
  for (const [id, url] of state.thumbs) {
    if (!state.media.has(id)) {
      URL.revokeObjectURL(url);
      state.thumbs.delete(id);
    }
  }
  if (pruned.length !== items.length) await savePlaylist(pruned);
  renderList();
  applySettingsToForm();
  await paintPlace();
  await paintStorage();
}

function syncScreenName() {
  const input = document.getElementById('screen-name');
  if (!input || !state.settings) return;
  state.settings.screenName = input.value.trim();
}

async function persistSettings() {
  syncScreenName();
  state.settings = await enqueue(() => saveSettings(state.settings));
  applySettingsToForm();
}

function markPlaying(id) {
  state.nowPlayingId = id;
  document.querySelectorAll('.row').forEach((row) => {
    row.classList.toggle('is-playing', row.dataset.id === id);
  });
}

async function ingestRecords(records) {
  let added = 0;
  for (const record of records) {
    status.textContent = `Saving ${record.name}…`;
    const thumb = record.thumb === undefined ? await makeThumb(record.blob, record.kind) : record.thumb;
    const media = {
      id: crypto.randomUUID(),
      name: record.name,
      kind: record.kind,
      mime: record.mime || record.blob.type || '',
      size: record.blob.size,
      blob: record.blob,
      thumb,
      addedAt: Date.now(),
    };
    await putMedia(media, { silent: true });
    state.media.set(media.id, media);
    state.items.push({
      id: crypto.randomUUID(),
      mediaId: media.id,
      duration: record.kind === 'video' ? 0 : (record.duration || state.settings.defaultDuration),
      enabled: true,
    });
    added += 1;
  }
  if (added) {
    await savePlaylist(state.items);
    toast(added === 1 ? 'Added 1 file' : `Added ${added} files`);
  }
  status.textContent = '';
  renderList();
  await paintStorage();
}

async function ingestFiles(fileList) {
  const files = [...fileList];
  if (!files.length || busy) return;
  const records = [];
  for (const file of files) {
    const kind = classify(file);
    if (!kind) {
      toast(`${file.name} needs to be an image, PDF, or MP4`);
      continue;
    }
    records.push({ name: file.name, kind, mime: file.type, blob: file });
  }
  if (!records.length) return;
  busy = true;
  document.getElementById('pick-files').disabled = true;
  document.getElementById('add-samples').disabled = true;
  try {
    await enqueue(() => ingestRecords(records));
  } catch (error) {
    console.error(error);
    toast(error?.name === 'QuotaExceededError' ? 'This browser ran out of space for media.' : 'Couldn’t save those files.');
    status.textContent = '';
  } finally {
    busy = false;
    document.getElementById('pick-files').disabled = false;
    document.getElementById('add-samples').disabled = false;
    document.getElementById('file-input').value = '';
  }
}

async function addSamples() {
  if (busy) return;
  busy = true;
  document.getElementById('add-samples').disabled = true;
  status.textContent = 'Making sample slides…';
  try {
    const samples = await createSampleMedia();
    const records = samples.map((sample) => ({
      ...sample,
      duration: sample.kind === 'pdf' ? 6 : sample.kind === 'image' ? 8 : 0,
      thumb: undefined,
    }));
    await enqueue(() => ingestRecords(records));
  } catch (error) {
    console.error(error);
    toast('Couldn’t create the sample slides.');
    status.textContent = '';
  } finally {
    busy = false;
    document.getElementById('add-samples').disabled = false;
  }
}

async function persistOrder() {
  const ids = [...list.querySelectorAll('.row')].map((row) => row.dataset.id);
  const same = ids.every((id, position) => state.items[position]?.id === id);
  if (same) return;
  state.items = ids.map((id) => state.items.find((item) => item.id === id)).filter(Boolean);
  await enqueue(() => savePlaylist(state.items));
}

async function move(id, direction) {
  const from = state.items.findIndex((item) => item.id === id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= state.items.length) return;
  const [item] = state.items.splice(from, 1);
  state.items.splice(to, 0, item);
  await enqueue(() => savePlaylist(state.items));
  renderList();
  list.querySelector(`[data-id="${CSS.escape(id)}"] [data-action="${direction}"]`)?.focus();
}

async function removeItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  const nextItems = state.items.filter((entry) => entry.id !== id);
  state.items = nextItems;
  renderList();
  suppressRemote += 1;
  try {
    await enqueue(async () => {
      await savePlaylist(nextItems);
      if (item) await deleteMedia(item.mediaId, { silent: true });
    });
    if (item) {
      const url = state.thumbs.get(item.mediaId);
      if (url) URL.revokeObjectURL(url);
      state.thumbs.delete(item.mediaId);
      state.media.delete(item.mediaId);
    }
    renderList();
    await paintStorage();
    toast('Removed from the playlist');
  } catch (error) {
    console.error(error);
    toast('Couldn’t remove that file');
    await load();
  } finally {
    suppressRemote -= 1;
  }
}

let armedDelete = null;
let suppressRemote = 0;

function disarmDelete() {
  if (!armedDelete) return;
  armedDelete.dataset.armed = '0';
  if (armedDelete.isConnected) armedDelete.textContent = 'Delete';
  armedDelete = null;
}

function armDelete(button, id) {
  if (armedDelete === button) {
    disarmDelete();
    removeItem(id);
    return;
  }
  disarmDelete();
  armedDelete = button;
  button.dataset.armed = '1';
  button.textContent = 'Delete?';
}

async function paintPlace() {
  const { locationLabel, latitude, longitude, units } = state.settings;
  if (latitude == null || longitude == null) {
    placeCard.hidden = true;
    placeCard.innerHTML = '';
    return;
  }
  placeCard.hidden = false;
  placeCard.innerHTML = `<div><p class="kicker">Selected place</p><h2>${escapeHtml(locationLabel || 'Saved location')}</h2><p class="meta">Fetching weather…</p></div><button type="button" id="clear-place" class="btn-ghost">Clear</button>`;
  const weather = await fetchWeather({ latitude, longitude, units });
  if (state.settings.latitude !== latitude || state.settings.longitude !== longitude) return;
  if (!weather?.ok) {
    placeCard.querySelector('.meta').textContent = 'Weather is unavailable right now.';
    return;
  }
  const unit = weather.units === 'fahrenheit' ? 'F' : 'C';
  placeCard.innerHTML = `<div class="place-now">${weatherIcon(weather.code, weather.isDay)}<div><p class="kicker">Selected place</p><h2>${escapeHtml(locationLabel || 'Saved location')}</h2><p class="meta">${Math.round(weather.temp)}°${unit} · ${escapeHtml(weather.label)} · ${Math.round(weather.humidity)}% humidity · wind ${Math.round(weather.wind)} ${weather.windUnit}</p></div></div><button type="button" id="clear-place" class="btn-ghost">Clear</button>`;
}

document.querySelectorAll('[data-panel]').forEach((button) => {
  button.addEventListener('click', () => showPanel(button.dataset.panel));
});
window.addEventListener('hashchange', () => showPanel(location.hash.slice(1)));

document.getElementById('pick-files').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', (event) => {
  ingestFiles(event.target.files);
});
document.getElementById('add-samples').addEventListener('click', addSamples);

const drop = document.getElementById('drop');
['dragenter', 'dragover'].forEach((type) => {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
});
drop.addEventListener('dragleave', (event) => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove('is-over');
});
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('is-over');
  ingestFiles(event.dataTransfer?.files);
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  if (!event.target.closest('#drop')) event.preventDefault();
});

list.addEventListener('pointerdown', (event) => {
  blockDrag = Boolean(event.target.closest('input, button, a, textarea, label'));
});
document.addEventListener('pointerdown', (event) => {
  if (armedDelete && event.target.closest('[data-action="delete"]') !== armedDelete) disarmDelete();
  if (clearAll.dataset.armed === '1' && !clearAll.contains(event.target)) {
    clearAll.dataset.armed = '0';
    clearAll.textContent = 'Remove all';
  }
});
list.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.row');
  if (!row || blockDrag) {
    event.preventDefault();
    return;
  }
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.id);
});
list.addEventListener('dragover', (event) => {
  event.preventDefault();
  const row = event.target.closest('.row');
  const dragging = list.querySelector('.dragging');
  if (!row || !dragging || row === dragging) return;
  const rect = row.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  list.insertBefore(dragging, after ? row.nextElementSibling : row);
});
list.addEventListener('drop', async (event) => {
  event.preventDefault();
  await persistOrder();
});
list.addEventListener('dragend', async () => {
  list.querySelectorAll('.dragging').forEach((row) => row.classList.remove('dragging'));
  await persistOrder();
});

list.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  const row = event.target.closest('.row');
  if (!button || !row) return;
  const { id } = row.dataset;
  if (button.dataset.action === 'up' || button.dataset.action === 'down') move(id, button.dataset.action);
  if (button.dataset.action === 'delete') armDelete(button, id);
  if (button.dataset.action === 'enable') {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    item.enabled = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(item.enabled));
    row.classList.toggle('is-off', !item.enabled);
    enqueue(() => savePlaylist(state.items));
  }
});

list.addEventListener('change', (event) => {
  const row = event.target.closest('.row');
  if (!row) return;
  const item = state.items.find((entry) => entry.id === row.dataset.id);
  if (!item) return;
  const media = state.media.get(item.mediaId);
  if (event.target.classList.contains('name-input') && media) {
    const name = event.target.value.trim();
    if (!name || name === media.name) return;
    media.name = name;
    enqueue(() => putMedia(media, { silent: true })).catch(() => toast('Couldn’t rename that file'));
  }
  if (event.target.classList.contains('duration-input')) {
    const value = Math.min(3600, Math.max(1, Math.round(Number(event.target.value) || state.settings.defaultDuration)));
    event.target.value = String(value);
    item.duration = value;
    enqueue(() => savePlaylist(state.items));
  }
  if (event.target.classList.contains('duration-mode')) {
    const number = row.querySelector('.duration-input');
    if (event.target.value === 'full') {
      item.duration = 0;
      number.disabled = true;
    } else {
      item.duration = Math.max(1, Number(number.value) || state.settings.defaultDuration);
      number.disabled = false;
      number.value = String(item.duration);
    }
    enqueue(() => savePlaylist(state.items));
  }
});

clearAll.addEventListener('click', async () => {
  if (clearAll.dataset.armed !== '1') {
    clearAll.dataset.armed = '1';
    clearAll.textContent = 'Remove everything?';
    return;
  }
  clearAll.dataset.armed = '0';
  clearAll.textContent = 'Remove all';
  try {
    await enqueue(() => clearLibrary());
    for (const url of state.thumbs.values()) URL.revokeObjectURL(url);
    state.thumbs.clear();
    state.media.clear();
    state.items = [];
    renderList();
    await paintStorage();
    toast('Playlist cleared');
  } catch (error) {
    console.error(error);
    toast('Couldn’t clear the playlist');
  }
});

const screenNameInput = document.getElementById('screen-name');
let screenNameTimer = 0;
screenNameInput.addEventListener('input', () => {
  syncScreenName();
  clearTimeout(screenNameTimer);
  screenNameTimer = setTimeout(() => persistSettings(), 200);
});
screenNameInput.addEventListener('change', () => {
  clearTimeout(screenNameTimer);
  persistSettings();
});

for (const [id, key] of [
  ['toggle-time', 'showTime'],
  ['toggle-date', 'showDate'],
  ['toggle-weather', 'showWeather'],
  ['toggle-sound', 'sound'],
]) {
  document.getElementById(id).addEventListener('click', () => {
    state.settings[key] = !state.settings[key];
    setSwitch(id, state.settings[key]);
    persistSettings();
  });
}

document.querySelectorAll('[data-hour]').forEach((button) => {
  button.addEventListener('click', () => {
    state.settings.hour12 = button.dataset.hour === '12';
    persistSettings();
  });
});
document.querySelectorAll('[data-fit]').forEach((button) => {
  button.addEventListener('click', () => {
    state.settings.fit = button.dataset.fit === 'cover' ? 'cover' : 'contain';
    persistSettings();
  });
});
document.querySelectorAll('[data-pos]').forEach((button) => {
  button.addEventListener('click', () => {
    state.settings.overlay = button.dataset.pos;
    persistSettings();
  });
});
document.querySelectorAll('[data-unit]').forEach((button) => {
  button.addEventListener('click', async () => {
    state.settings.units = button.dataset.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
    await persistSettings();
    paintPlace();
  });
});

document.getElementById('default-duration').addEventListener('change', (event) => {
  const value = Math.min(3600, Math.max(1, Math.round(Number(event.target.value) || 12)));
  event.target.value = String(value);
  state.settings.defaultDuration = value;
  persistSettings();
});
document.getElementById('fade').addEventListener('input', (event) => {
  state.settings.transitionMs = Number(event.target.value);
  document.getElementById('fade-label').textContent = state.settings.transitionMs ? `${state.settings.transitionMs} ms` : 'None';
});
document.getElementById('fade').addEventListener('change', () => persistSettings());

document.getElementById('place-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = document.getElementById('place-query').value.trim();
  if (query.length < 2) {
    toast('Type at least two letters of a city');
    return;
  }
  placeResults.innerHTML = '<li class="meta">Searching…</li>';
  try {
    lastResults = await searchPlaces(query);
    if (!lastResults.length) {
      placeResults.innerHTML = '<li class="meta">No matching city.</li>';
      return;
    }
    placeResults.innerHTML = lastResults.map((place, placeIndex) => {
      const detail = [place.timezone?.replaceAll('_', ' '), place.country_code].filter(Boolean).join(' · ');
      return `<li><button type="button" data-pick="${placeIndex}"><strong>${escapeHtml(formatPlace(place))}</strong><span>${escapeHtml(detail)}</span></button></li>`;
    }).join('');
  } catch (error) {
    console.error(error);
    placeResults.innerHTML = '';
    toast('City search is unavailable right now');
  }
});

placeResults.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-pick]');
  if (!button) return;
  const place = lastResults[Number(button.dataset.pick)];
  if (!place) return;
  state.settings.locationLabel = formatPlace(place);
  state.settings.latitude = place.latitude;
  state.settings.longitude = place.longitude;
  placeResults.innerHTML = '';
  document.getElementById('place-query').value = '';
  await persistSettings();
  await paintPlace();
  toast(`Weather set to ${state.settings.locationLabel}`);
});

document.getElementById('use-location').addEventListener('click', () => {
  if (!navigator.geolocation) {
    toast('This browser has no location service');
    return;
  }
  status.textContent = 'Finding this device…';
  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      const { latitude, longitude } = position.coords;
      state.settings.latitude = latitude;
      state.settings.longitude = longitude;
      state.settings.locationLabel = await reversePlace(latitude, longitude);
      await persistSettings();
      await paintPlace();
      toast(`Weather set to ${state.settings.locationLabel}`);
    } catch (error) {
      console.error(error);
      toast('Couldn’t look up this location');
    } finally {
      status.textContent = '';
    }
  }, () => {
    status.textContent = '';
    toast('Location permission was blocked');
  }, { enableHighAccuracy: false, timeout: 8000 });
});

placeCard.addEventListener('click', async (event) => {
  if (!event.target.closest('#clear-place')) return;
  state.settings.locationLabel = '';
  state.settings.latitude = null;
  state.settings.longitude = null;
  await persistSettings();
  await paintPlace();
});

try {
  await load();
  document.getElementById('needs-http')?.remove();
  showPanel(location.hash.slice(1) || 'playlist');
  onRemote((message) => {
    if (message.type === 'now-playing') {
      markPlaying(message.itemId);
      return;
    }
    if ((message.type === 'playlist' || message.type === 'media') && suppressRemote) return;
    if (message.type === 'playlist' || message.type === 'media' || message.type === 'settings') {
      load().catch((error) => console.error(error));
    }
  });
} catch (error) {
  console.error(error);
  const note = document.getElementById('needs-http');
  if (note) {
    note.hidden = false;
    note.textContent = 'This browser blocked storage, so the studio can’t save media.';
  }
}
