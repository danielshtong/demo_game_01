const svg = (body) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/>'),
  moon: svg('<path d="M20 14.6A7.8 7.8 0 1 1 9.4 4 6.2 6.2 0 0 0 20 14.6z"/>'),
  cloud: svg('<path d="M7.2 18h9.2a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.6A3.4 3.4 0 0 0 7.2 18z"/>'),
  sunCloud: svg('<path d="M12 4.2V3M15.2 5.4l.8-.8M8.8 5.4l-.8-.8M16.5 8.5h1.2"/><circle cx="10" cy="8" r="2.4"/><path d="M7 17.5h8.6a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.8 1.4A2.9 2.9 0 0 0 7 17.5z"/>'),
  fog: svg('<path d="M5 8h14M4 12h16M6 16h12"/>'),
  rain: svg('<path d="M7 14.5h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1.4A3 3 0 0 0 7 14.5z"/><path d="M8.5 17.2l-.8 2M12 17.2l-.8 2M15.5 17.2l-.8 2"/>'),
  snow: svg('<path d="M7 14h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1.4A3 3 0 0 0 7 14z"/><path d="M8 17.5h.1M12 17.5h.1M16 17.5h.1M10 20h.1M14 20h.1"/>'),
  thunder: svg('<path d="M7 13.5h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1.4A3 3 0 0 0 7 13.5z"/><path d="M11 14.5l-1.6 3.6h2.4L10.2 22"/>'),
};

let regionNames;

function regionName(code) {
  if (!code) return '';
  try {
    regionNames ||= new Intl.DisplayNames(undefined, { type: 'region' });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

export function formatPlace(place) {
  const country = place.country || regionName(place.country_code);
  const parts = [place.name];
  if (place.admin1 && place.admin1 !== place.name) parts.push(place.admin1);
  if (country && !parts.includes(country)) parts.push(country);
  return parts.join(', ');
}

export function describeWeather(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code === 61 || code === 80) return 'Light rain';
  if (code === 63 || code === 81) return 'Rain';
  if (code === 65 || code === 82) return 'Heavy rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code === 71 || code === 85) return 'Light snow';
  if (code === 73) return 'Snow';
  if (code === 75 || code === 86) return 'Heavy snow';
  if (code === 77) return 'Snow grains';
  if (code >= 95) return 'Thunderstorm';
  return 'Current conditions';
}

export function weatherIcon(code, isDay) {
  if (code === 0) return isDay ? ICONS.sun : ICONS.moon;
  if (code === 1 || code === 2) return isDay ? ICONS.sunCloud : ICONS.cloud;
  if (code === 3) return ICONS.cloud;
  if (code === 45 || code === 48) return ICONS.fog;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ICONS.snow;
  if (code >= 95) return ICONS.thunder;
  if (code >= 51) return ICONS.rain;
  return ICONS.cloud;
}

export async function searchPlaces(query) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '6');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const response = await fetch(url);
  if (!response.ok) throw new Error('City search failed');
  const data = await response.json();
  return data.results || [];
}

export async function reversePlace(latitude, longitude) {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('localityLanguage', 'en');
  const response = await fetch(url);
  if (!response.ok) throw new Error('Location lookup failed');
  const data = await response.json();
  const locality = data.locality && data.locality !== data.city ? data.locality : '';
  const parts = [...new Set([locality, data.city, data.countryName].filter(Boolean))];
  return parts.join(', ') || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
}

function cacheKey(latitude, longitude, units) {
  return `${Number(latitude).toFixed(3)},${Number(longitude).toFixed(3)},${units}`;
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem('lumina-weather');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.key !== key || Date.now() - parsed.weather.at > 10 * 60 * 1000) return null;
    return parsed.weather;
  } catch {
    return null;
  }
}

function writeCache(key, weather) {
  try {
    sessionStorage.setItem('lumina-weather', JSON.stringify({ key, weather }));
  } catch {
    /* ignore quota */
  }
}

export async function fetchWeather({ latitude, longitude, units, force = false }) {
  if (latitude == null || longitude == null) return null;
  const key = cacheKey(latitude, longitude, units);
  if (!force) {
    const cached = readCache(key);
    if (cached) return cached;
  }
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
      timezone: 'auto',
    });
    if (units === 'fahrenheit') {
      params.set('temperature_unit', 'fahrenheit');
      params.set('wind_speed_unit', 'mph');
    }
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error('Weather request failed');
    const data = await response.json();
    const current = data.current;
    const weather = {
      ok: true,
      temp: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      code: current.weather_code,
      isDay: current.is_day === 1,
      wind: current.wind_speed_10m,
      windUnit: units === 'fahrenheit' ? 'mph' : 'km/h',
      label: describeWeather(current.weather_code),
      units: units === 'fahrenheit' ? 'fahrenheit' : 'celsius',
      at: Date.now(),
    };
    writeCache(key, weather);
    return weather;
  } catch {
    return { ok: false };
  }
}
