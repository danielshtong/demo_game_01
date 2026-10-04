import { getAllMedia, getMedia, getPlaylist, getSettings, notify, onRemote } from './db.js';
import { fetchWeather } from './weather.js';
import { renderClock, renderWeather, startClock } from './widgets.js';

const embed = new URLSearchParams(location.search).has('embed');
const layers = [document.getElementById('layer-a'), document.getElementById('layer-b')];
const readyCopy = document.getElementById('ready-copy');
const counter = document.getElementById('counter');
const progressWrap = document.getElementById('progress');
const progressBar = progressWrap.querySelector('span');

let settings = null;
let items = [];
let index = 0;
let front = -1;
let holdTimer = 0;
let holdToken = 0;
let weatherState = null;
let weatherKey = '';
let looping = false;
let activeItemId = null;
let wakeSentinel = null;
let pdfjsPromise = null;

document.getElementById('needs-http')?.remove();
if (embed) document.documentElement.classList.add('is-embed');

class Playback {
  constructor() {
    this.generation = 0;
    this.pending = [];
    this.progress = null;
  }

  interrupt() {
    this.generation += 1;
    const pending = this.pending.splice(0);
    for (const cancel of pending) cancel();
    this.progress?.cancel();
    this.progress = null;
    return this.generation;
  }

  wait(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((fn) => fn !== cancel);
        resolve();
      }, ms);
      const cancel = () => {
        clearTimeout(timer);
        resolve();
      };
      this.pending.push(cancel);
    });
  }

  waitFor(target, types) {
    return new Promise((resolve) => {
      const finish = (type) => {
        for (const eventType of types) target.removeEventListener(eventType, onEvent);
        this.pending = this.pending.filter((fn) => fn !== cancel);
        resolve(type);
      };
      const onEvent = (event) => finish(event.type);
      const cancel = () => finish('cancel');
      for (const eventType of types) target.addEventListener(eventType, onEvent);
      this.pending.push(cancel);
    });
  }
}

const playback = new Playback();

function loadPdfJs() {
  pdfjsPromise ||= import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
    return pdfjs;
  });
  return pdfjsPromise;
}

function clearLayer(layer) {
  layer.querySelectorAll('video').forEach((video) => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
  if (layer._url) URL.revokeObjectURL(layer._url);
  layer._url = null;
  layer.dataset.key = '';
  layer.classList.remove('is-in', 'is-hold', 'kind-pdf');
  layer.replaceChildren();
}

function hideSoundNote() {
  const note = document.getElementById('sound-note');
  if (note) note.hidden = true;
}

function present(node, key, url, kind) {
  if (front >= 0 && layers[front].dataset.key === key && layers[front].classList.contains('is-in')) {
    return false;
  }
  const token = ++holdToken;
  const incoming = layers[front === -1 ? 0 : 1 - front];
  const outgoing = front === -1 ? null : layers[front];
  const previousUrl = incoming._url;
  incoming.replaceChildren(node);
  incoming.dataset.key = key;
  incoming._url = url || null;
  if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl);
  incoming.classList.toggle('kind-pdf', kind === 'pdf');
  incoming.classList.remove('is-hold');
  incoming.classList.add('is-in');
  if (outgoing) {
    outgoing.querySelectorAll('video').forEach((video) => video.pause());
    outgoing.classList.remove('is-in');
    outgoing.classList.add('is-hold');
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (token !== holdToken || layers[front] === outgoing) return;
      clearLayer(outgoing);
    }, Math.max(0, settings.transitionMs));
  }
  front = layers.indexOf(incoming);
  hideSoundNote();
  return true;
}

function applyFit() {
  const cover = settings.fit === 'cover';
  document.documentElement.style.setProperty('--fade', `${settings.transitionMs}ms`);
  for (const layer of layers) layer.classList.toggle('fit-cover', cover);
  const video = document.querySelector('.layer.is-in video');
  if (video) video.muted = !settings.sound;
}

function paint() {
  renderClock(settings);
  renderWeather(settings, weatherState);
  applyFit();
  document.title = settings.screenName ? `Lumina · ${settings.screenName}` : 'Lumina';
}

async function refreshWeather(force = false) {
  const key = `${settings.latitude},${settings.longitude},${settings.units}`;
  if (settings.latitude == null || settings.longitude == null) {
    weatherKey = key;
    weatherState = null;
    renderWeather(settings, null);
    return;
  }
  if (force || key !== weatherKey) {
    weatherState = null;
    renderWeather(settings, null);
  }
  weatherKey = key;
  const next = await fetchWeather({
    latitude: settings.latitude,
    longitude: settings.longitude,
    units: settings.units,
    force,
  });
  if (`${settings.latitude},${settings.longitude},${settings.units}` !== key) return;
  weatherState = next;
  renderWeather(settings, weatherState);
}

function announce(text) {
  document.getElementById('announcer').textContent = text;
}

function startProgress(ms) {
  progressWrap.hidden = false;
  playback.progress?.cancel();
  progressBar.style.width = '0%';
  if (ms <= 0) return;
  playback.progress = progressBar.animate(
    [{ width: '0%' }, { width: '100%' }],
    { duration: ms, easing: 'linear', fill: 'forwards' },
  );
}

function trackVideo(video) {
  progressWrap.hidden = false;
  playback.progress?.cancel();
  const onTime = () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    progressBar.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
  };
  const stop = () => video.removeEventListener('timeupdate', onTime);
  video.addEventListener('timeupdate', onTime);
  playback.pending.push(stop);
  return stop;
}

function errorNode(name) {
  const wrap = document.createElement('div');
  wrap.className = 'slide-error';
  const label = document.createElement('p');
  label.textContent = 'This file can’t play';
  const title = document.createElement('strong');
  title.textContent = name || 'Untitled';
  wrap.append(label, title);
  return wrap;
}

async function playBroken(name) {
  present(errorNode(name), `error:${name}:${Date.now()}`, null, 'error');
  announce(`Can’t play ${name}`);
  startProgress(4000);
  await playback.wait(4000);
  return false;
}

function showSoundNote(video) {
  let button = document.getElementById('sound-note');
  if (!button) {
    button = document.createElement('button');
    button.id = 'sound-note';
    button.type = 'button';
    button.className = 'sound-note';
    button.textContent = 'Tap for sound';
    document.body.append(button);
  }
  button.hidden = false;
  button.onclick = async () => {
    video.muted = false;
    try {
      await video.play();
    } catch {
      video.muted = true;
    }
    button.hidden = true;
  };
}

async function playImage(media, item, generation) {
  const url = URL.createObjectURL(media.blob);
  const image = new Image();
  image.alt = '';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return playBroken(media.name);
  }
  if (playback.generation !== generation) {
    URL.revokeObjectURL(url);
    return true;
  }
  const mounted = present(image, media.id, url, 'image');
  if (!mounted) URL.revokeObjectURL(url);
  announce(media.name);
  notify({ type: 'now-playing', itemId: item.id });
  const ms = Math.max(1, item.duration || settings.defaultDuration) * 1000;
  startProgress(ms);
  await playback.wait(ms);
  return true;
}

async function playVideo(media, item, generation) {
  const existing = front >= 0 ? layers[front].querySelector('video') : null;
  if (existing && layers[front].dataset.key === media.id) {
    existing.loop = item.duration > 0;
    existing.muted = !settings.sound;
    announce(media.name);
    notify({ type: 'now-playing', itemId: item.id });
    if (item.duration > 0) {
      if (existing.paused) existing.play().catch(() => {});
      const ms = item.duration * 1000;
      startProgress(ms);
      await playback.wait(ms);
      return true;
    }
    try {
      existing.currentTime = 0;
      await existing.play();
    } catch {
      return playBroken(media.name);
    }
    const stop = trackVideo(existing);
    const replay = await playback.waitFor(existing, ['ended', 'error']);
    stop();
    if (playback.generation !== generation) return true;
    return replay !== 'error';
  }
  const url = URL.createObjectURL(media.blob);
  const video = document.createElement('video');
  video.playsInline = true;
  video.autoplay = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  video.loop = item.duration > 0;
  video.muted = !settings.sound;
  if (video.muted) video.setAttribute('muted', '');
  video.src = url;
  const mounted = present(video, media.id, url, 'video');
  if (!mounted) {
    URL.revokeObjectURL(url);
  }
  announce(media.name);
  notify({ type: 'now-playing', itemId: item.id });
  try {
    await video.play();
  } catch {
    video.muted = true;
    try {
      await video.play();
      if (settings.sound) showSoundNote(video);
    } catch {
      return playBroken(media.name);
    }
  }
  if (playback.generation !== generation) return true;
  if (item.duration > 0) {
    const ms = item.duration * 1000;
    startProgress(ms);
    await playback.wait(ms);
    video.pause();
    return true;
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    await Promise.race([
      playback.waitFor(video, ['loadedmetadata', 'durationchange', 'error']),
      playback.wait(4000),
    ]);
  }
  if (playback.generation !== generation) return true;
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    await playback.wait(30000);
    return playback.generation === generation;
  }
  const stop = trackVideo(video);
  const result = await playback.waitFor(video, ['ended', 'error']);
  stop();
  if (playback.generation !== generation) return true;
  if (result === 'error') return playBroken(media.name);
  return true;
}

async function renderPdfPage(page, generation) {
  const stage = document.getElementById('layers').getBoundingClientRect();
  const width = Math.max(stage.width, 320);
  const height = Math.max(stage.height, 180);
  const base = page.getViewport({ scale: 1 });
  const cssScale = Math.min(width / base.width, height / base.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: cssScale * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const renderTask = page.render({ canvasContext: context, viewport });
  const cancel = () => {
    try {
      renderTask.cancel();
    } catch {
      /* already finished */
    }
  };
  playback.pending.push(cancel);
  try {
    await renderTask.promise;
  } catch {
    return null;
  } finally {
    playback.pending = playback.pending.filter((fn) => fn !== cancel);
  }
  if (playback.generation !== generation) return null;
  return canvas;
}

async function playPdfFrame(media, item, generation) {
  const url = URL.createObjectURL(media.blob);
  const frame = document.createElement('iframe');
  frame.className = 'pdf-frame';
  frame.title = media.name;
  frame.src = `${url}#toolbar=0&navpanes=0&scrollbar=0`;
  present(frame, `${media.id}:frame`, url, 'pdf');
  announce(media.name);
  notify({ type: 'now-playing', itemId: item.id });
  const ms = Math.max(1, item.duration || settings.defaultDuration) * 1000;
  startProgress(ms);
  await playback.wait(ms);
  return playback.generation === generation;
}

async function playPdf(media, item, generation) {
  let pdf = null;
  try {
    const pdfjs = await loadPdfJs();
    const data = await media.blob.arrayBuffer();
    if (playback.generation !== generation) return true;
    pdf = await pdfjs.getDocument({ data }).promise;
    if (!pdf.numPages) return false;
    const seconds = Math.max(1, item.duration || settings.defaultDuration);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (playback.generation !== generation) return true;
      const page = await pdf.getPage(pageNumber);
      const canvas = await renderPdfPage(page, generation);
      if (!canvas) {
        if (playback.generation !== generation) return true;
        throw new Error('Could not render a PDF page');
      }
      present(canvas, `${media.id}:${pageNumber}`, null, 'pdf');
      announce(`${media.name}, page ${pageNumber} of ${pdf.numPages}`);
      notify({ type: 'now-playing', itemId: item.id });
      counter.textContent = `${index + 1} / ${items.length}`;
      startProgress(seconds * 1000);
      await playback.wait(seconds * 1000);
      if (playback.generation !== generation) return true;
    }
    return true;
  } catch (error) {
    if (playback.generation !== generation) return true;
    console.error(error);
    try {
      return await playPdfFrame(media, item, generation);
    } catch {
      return false;
    }
  } finally {
    pdf?.destroy?.();
  }
}

async function playItem(item, generation) {
  const media = await getMedia(item.mediaId);
  if (playback.generation !== generation) return true;
  if (!media?.blob) return playBroken(item.name || 'Missing file');
  activeItemId = item.id;
  counter.textContent = `${index + 1} / ${items.length}`;
  if (media.kind === 'image') return playImage(media, item, generation);
  if (media.kind === 'video') return playVideo(media, item, generation);
  if (media.kind === 'pdf') return playPdf(media, item, generation);
  return playBroken(media.name);
}

function enterStandby(message) {
  document.body.classList.remove('has-media');
  for (const layer of layers) clearLayer(layer);
  front = -1;
  progressWrap.hidden = true;
  counter.textContent = '';
  readyCopy.textContent = message;
  hideSoundNote();
  notify({ type: 'now-playing', itemId: null });
}

async function cycle(generation) {
  looping = true;
  let failures = 0;
  try {
    while (playback.generation === generation) {
      if (!items.length) {
        enterStandby('Nothing is queued yet. Add media in the studio, and choose a city for the weather.');
        return;
      }
      if (index >= items.length) index = 0;
      const item = items[index];
      document.body.classList.add('has-media');
      const ok = await playItem(item, generation);
      if (playback.generation !== generation) return;
      failures = ok ? 0 : failures + 1;
      if (failures >= items.length) {
        enterStandby('Those files couldn’t play. Try a different image, PDF, or MP4.');
        return;
      }
      const position = items.findIndex((entry) => entry.id === activeItemId);
      index = position === -1 ? 0 : (position + 1) % items.length;
    }
  } finally {
    if (playback.generation === generation) looping = false;
  }
}

function startLoop() {
  const generation = playback.interrupt();
  if (!items.length) {
    looping = false;
    enterStandby('Nothing is queued yet. Add media in the studio, and choose a city for the weather.');
    return;
  }
  document.body.classList.add('has-media');
  cycle(generation);
}

async function loadItems() {
  const [playlist, media] = await Promise.all([getPlaylist(), getAllMedia()]);
  const ids = new Set(media.map((entry) => entry.id));
  items = playlist.filter((item) => item.enabled !== false && ids.has(item.mediaId));
  if (index >= items.length) index = 0;
}

function skip(step) {
  if (!items.length) return;
  index = (index + step + items.length) % items.length;
  startLoop();
}

async function requestWake() {
  try {
    wakeSentinel = await navigator.wakeLock?.request('screen');
  } catch {
    wakeSentinel = null;
  }
}

let idleTimer = 0;
function wakeCursor() {
  document.body.classList.add('awake');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.remove('awake'), 2800);
}

document.getElementById('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* Full screen can be refused without a user gesture. */
  }
});
document.getElementById('prev-item').addEventListener('click', () => skip(-1));
document.getElementById('next-item').addEventListener('click', () => skip(1));
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') skip(1);
  if (event.key === 'ArrowLeft') skip(-1);
  if (event.key === 'f' || event.key === 'F') {
    document.getElementById('fullscreen').click();
  }
});
document.addEventListener('fullscreenchange', () => {
  const button = document.getElementById('fullscreen');
  button.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});
['pointermove', 'pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, wakeCursor));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  document.querySelector('.layer.is-in video')?.play?.().catch(() => {});
  requestWake();
});
window.addEventListener('resize', () => {
  const canvas = document.querySelector('.layer.is-in canvas');
  if (!canvas) return;
  const stage = document.getElementById('layers').getBoundingClientRect();
  const ratio = canvas.width / canvas.height;
  let width = stage.width;
  let height = width / ratio;
  if (height > stage.height) {
    height = stage.height;
    width = height * ratio;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
});

onRemote(async (message) => {
  if (!settings) return;
  if (message.type === 'settings') {
    settings = await getSettings();
    paint();
    refreshWeather(false);
    return;
  }
  if (message.type === 'playlist' || message.type === 'media') {
    const previous = activeItemId;
    const previousIndex = index;
    await loadItems();
    const stillPlaying = previous && items.some((item) => item.id === previous);
    if (!looping || !items.length || (previous && !stillPlaying)) {
      if (previous && !stillPlaying) {
        index = previousIndex >= items.length ? 0 : previousIndex;
      }
      startLoop();
    }
  }
});

readyCopy.textContent = 'Loading the playlist…';
try {
  settings = await getSettings();
  paint();
  startClock(() => settings);
  refreshWeather(false);
  setInterval(() => refreshWeather(true), 15 * 60 * 1000);
  await loadItems();
  startLoop();
  requestWake();
  wakeCursor();
} catch (error) {
  console.error(error);
  readyCopy.textContent = 'This browser blocked storage, so the screen can’t open the playlist.';
}
