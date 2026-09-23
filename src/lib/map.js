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

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  return map;
}

export function createCameraIcon(active = false) {
  return L.divIcon({
    className: "",
    html: `<span class="cam-marker${active ? " is-active" : ""}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

export function fitToCameras(map, cameras) {
  if (!cameras.length) return;
  const bounds = L.latLngBounds(cameras.map((c) => [c.lat, c.lng]));
  map.fitBounds(bounds.pad(0.08), { animate: true, maxZoom: 13 });
}
