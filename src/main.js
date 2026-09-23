import "./style.css";
import L from "leaflet";
import camerasData from "./data/cameras.json";
import { fetchTrafficNews, cameraImageUrl } from "./lib/api.js";
import { createMap, createCameraIcon, fitToCameras } from "./lib/map.js";

const REGION_SHORT = {
  "Hong Kong Island": "HK Island",
  Kowloon: "Kowloon",
  Lantau: "Lantau",
  "Shatin & Ma On Shan": "Sha Tin",
  "Tai Po, North & Yuen Long": "N.T. North",
  "Tsuen Wan": "Tsuen Wan",
  "Tuen Mun & Tin Shui Wai": "Tuen Mun",
};

const state = {
  cameras: camerasData,
  filtered: camerasData,
  activeRegions: new Set(),
  query: "",
  selectedId: null,
  markers: new Map(),
  newsTimer: null,
  imageTimer: null,
};

const els = {
  map: document.getElementById("map"),
  search: document.getElementById("search"),
  regions: document.getElementById("region-filters"),
  clear: document.getElementById("clear-filters"),
  news: document.getElementById("news-list"),
  refresh: document.getElementById("refresh-btn"),
  cameraSection: document.getElementById("camera-section"),
  cameraDetail: document.getElementById("camera-detail"),
  cameraList: document.getElementById("camera-list"),
  cameraCount: document.getElementById("camera-count"),
  closeCamera: document.getElementById("close-camera"),
  clock: document.getElementById("clock"),
  status: document.getElementById("status-pill"),
  panel: document.getElementById("panel"),
  tabs: document.querySelectorAll(".tab"),
};

const map = createMap(els.map);
const layer = L.layerGroup().addTo(map);

function setStatus(mode, label) {
  els.status.className = `status-pill is-${mode}`;
  els.status.textContent = label;
}

function tickClock() {
  const now = new Date();
  els.clock.textContent = now.toLocaleTimeString("en-HK", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Hong_Kong",
  });
}

function regions() {
  return [...new Set(state.cameras.map((c) => c.region))].sort();
}

function renderRegionChips() {
  els.regions.innerHTML = "";
  for (const region of regions()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${state.activeRegions.has(region) ? " is-active" : ""}`;
    btn.textContent = REGION_SHORT[region] || region;
    btn.title = region;
    btn.addEventListener("click", () => {
      if (state.activeRegions.has(region)) state.activeRegions.delete(region);
      else state.activeRegions.add(region);
      applyFilters({ fit: true });
      renderRegionChips();
    });
    els.regions.appendChild(btn);
  }
}

function matchesQuery(camera, query) {
  if (!query) return true;
  const hay = `${camera.id} ${camera.name} ${camera.region}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

function applyFilters({ fit = false } = {}) {
  state.filtered = state.cameras.filter((camera) => {
    const regionOk =
      state.activeRegions.size === 0 || state.activeRegions.has(camera.region);
    return regionOk && matchesQuery(camera, state.query);
  });
  renderMarkers();
  renderCameraList();
  if (fit && state.filtered.length) fitToCameras(map, state.filtered);
}

function renderCameraList() {
  els.cameraCount.textContent = String(state.filtered.length);
  const rows = state.filtered.slice(0, 40);
  if (!rows.length) {
    els.cameraList.innerHTML = `<p class="muted">No cameras match this filter.</p>`;
    return;
  }

  els.cameraList.innerHTML = rows
    .map(
      (camera) => `
      <button type="button" class="camera-row${camera.id === state.selectedId ? " is-active" : ""}" data-camera="${escapeHtml(camera.id)}">
        <strong>${escapeHtml(camera.name)}</strong>
        <span>${escapeHtml(REGION_SHORT[camera.region] || camera.region)} · ${escapeHtml(camera.id)}</span>
      </button>`
    )
    .join("");

  els.cameraList.querySelectorAll("[data-camera]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectCamera(btn.getAttribute("data-camera"), { openPanel: true, openPopup: true });
    });
  });
}

function renderMarkers() {
  layer.clearLayers();
  state.markers.clear();

  for (const camera of state.filtered) {
    const marker = L.marker([camera.lat, camera.lng], {
      icon: createCameraIcon(camera.id === state.selectedId),
      title: camera.name,
      keyboard: true,
      riseOnHover: true,
    });

    marker.bindPopup(
      `<p class="popup-title">${escapeHtml(camera.name)}</p>
       <p class="popup-meta">${escapeHtml(camera.region)} · ${escapeHtml(camera.id)}</p>
       <button type="button" class="popup-btn" data-open="${escapeHtml(camera.id)}">Open camera</button>`,
      { closeButton: true, autoPan: true }
    );

    marker.on("click", () => {
      selectCamera(camera.id, { fromMap: true, openPopup: true });
    });

    marker.on("popupopen", () => {
      const btn = document.querySelector(`[data-open="${CSS.escape(camera.id)}"]`);
      btn?.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          selectCamera(camera.id, { openPanel: true });
        },
        { once: true }
      );
    });

    marker.addTo(layer);
    state.markers.set(camera.id, marker);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function selectCamera(id, { fromMap = false, openPanel = false, openPopup = false } = {}) {
  const camera = state.cameras.find((c) => c.id === id);
  if (!camera) return;

  const previous = state.selectedId;
  state.selectedId = id;

  // Refresh icons without wiping the clicked marker mid-event when possible
  if (previous && state.markers.has(previous)) {
    state.markers.get(previous).setIcon(createCameraIcon(false));
  }

  let marker = state.markers.get(id);
  if (!marker) {
    renderMarkers();
    marker = state.markers.get(id);
  } else {
    marker.setIcon(createCameraIcon(true));
  }

  if (marker) {
    map.setView([camera.lat, camera.lng], Math.max(map.getZoom(), 14), { animate: true });
    if (openPopup || fromMap) marker.openPopup();
  }

  els.cameraSection.classList.remove("is-empty");
  els.cameraDetail.innerHTML = `
    <img src="${cameraImageUrl(camera)}" alt="Live traffic camera at ${escapeHtml(camera.name)}" loading="eager" />
    <h3>${escapeHtml(camera.name)}</h3>
    <p class="meta">${escapeHtml(camera.region)} · Camera ${escapeHtml(camera.id)}</p>
  `;

  renderCameraList();
  els.cameraSection.scrollIntoView({ behavior: "smooth", block: "nearest" });

  if (openPanel || window.matchMedia("(max-width: 900px)").matches) {
    setMobileView("panel");
  }

  restartImageRefresh();
}

function clearCamera() {
  const previous = state.selectedId;
  state.selectedId = null;
  els.cameraSection.classList.add("is-empty");
  els.cameraDetail.innerHTML = "";
  if (previous && state.markers.has(previous)) {
    state.markers.get(previous).setIcon(createCameraIcon(false));
  }
  renderCameraList();
  if (state.imageTimer) clearInterval(state.imageTimer);
}

function restartImageRefresh() {
  if (state.imageTimer) clearInterval(state.imageTimer);
  state.imageTimer = setInterval(() => {
    if (!state.selectedId) return;
    const camera = state.cameras.find((c) => c.id === state.selectedId);
    const img = els.cameraDetail.querySelector("img");
    if (camera && img) img.src = cameraImageUrl(camera);
  }, 120_000);
}

function renderNews(items) {
  if (!items.length) {
    els.news.innerHTML = `<p class="muted">No special traffic notices right now.</p>`;
    return;
  }

  els.news.innerHTML = items
    .map(
      (item, index) => `
      <article class="news-card" data-status="${escapeHtml(item.status)}" style="animation-delay:${index * 40}ms">
        <span class="news-status">${escapeHtml(item.statusLabel)}</span>
        <p>${escapeHtml(item.title || item.body)}</p>
        <p class="news-time">${escapeHtml(item.time)}</p>
      </article>`
    )
    .join("");
}

async function loadNews() {
  setStatus("loading", "Syncing…");
  try {
    const items = await fetchTrafficNews();
    renderNews(items);
    setStatus("ready", `${items.length} live notice${items.length === 1 ? "" : "s"}`);
  } catch (error) {
    console.error(error);
    els.news.innerHTML = `<p class="muted">Could not load traffic news. Check your connection and try Refresh.</p>`;
    setStatus("error", "News offline");
  }
}

function setMobileView(view) {
  const open = view === "panel";
  els.panel.classList.toggle("is-open", open);
  document.body.classList.toggle("panel-open", open);
  els.tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
  if (!open) {
    requestAnimationFrame(() => map.invalidateSize());
  }
}

function bindEvents() {
  let searchTimer;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value.trim();
      applyFilters({ fit: true });
    }, 120);
  });

  els.clear.addEventListener("click", () => {
    state.activeRegions.clear();
    state.query = "";
    els.search.value = "";
    renderRegionChips();
    applyFilters({ fit: true });
  });

  els.refresh.addEventListener("click", () => loadNews());
  els.closeCamera.addEventListener("click", () => clearCamera());

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setMobileView(tab.dataset.view));
  });

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 900px)").matches) {
      els.panel.classList.add("is-open");
      document.body.classList.remove("panel-open");
    }
  });
}

function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  renderRegionChips();
  applyFilters({ fit: true });
  bindEvents();
  loadNews();
  state.newsTimer = setInterval(loadNews, 5 * 60_000);

  if (!window.matchMedia("(max-width: 900px)").matches) {
    els.panel.classList.add("is-open");
  }

  setTimeout(() => map.invalidateSize(), 100);
}

boot();
