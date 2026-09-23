import L from "leaflet";

const HK_CENTER = [22.3193, 114.1694];
const HK_BOUNDS = L.latLngBounds([22.15, 113.82], [22.58, 114.45]);

export function createMap(container) {
  const map = L.map(container, {
    center: HK_CENTER,
    zoom: 12,
    minZoom: 10,
    maxZoom: 18,
    maxBounds: HK_BOUNDS.pad(0.15),
    zoomControl: false,
    attributionControl: true,
  });

  L.control.zoom({ position: "bottomleft" }).addTo(map);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    className: "hk-basemap",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  return map;
}

export function createCameraIcon(active = false) {
  return L.divIcon({
    className: "cam-icon",
    html: `<button type="button" class="cam-marker${active ? " is-active" : ""}" aria-label="Traffic camera"></button>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

export function fitToCameras(map, cameras) {
  if (!cameras.length) return;
  const bounds = L.latLngBounds(cameras.map((c) => [c.lat, c.lng]));
  map.fitBounds(bounds.pad(0.08), { animate: true, maxZoom: 13 });
}
