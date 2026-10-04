import { weatherIcon } from './weather.js';

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

export function renderClock(settings) {
  const now = new Date();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: settings.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: settings.hour12 ? 'h12' : 'h23',
  }).format(now);
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
  const screenName = settings.screenName.trim();

  document.querySelectorAll('[data-time]').forEach((node) => {
    node.hidden = !settings.showTime;
    node.textContent = time;
  });
  document.querySelectorAll('[data-date]').forEach((node) => {
    node.hidden = !settings.showDate;
    node.textContent = date;
  });
  document.querySelectorAll('[data-screen-name]').forEach((node) => {
    node.hidden = !screenName;
    node.textContent = screenName;
  });
  document.querySelectorAll('[data-clock-card]').forEach((node) => {
    node.hidden = !settings.showTime && !settings.showDate && !screenName;
  });
  document.querySelectorAll('[data-hud]').forEach((node) => {
    node.classList.remove('hud-top-left', 'hud-top-right', 'hud-bottom-left', 'hud-bottom-right');
    node.classList.add(`hud-${settings.overlay}`);
    const weatherOn = settings.showWeather && settings.latitude != null;
    const clockOn = settings.showTime || settings.showDate || Boolean(screenName);
    node.hidden = !weatherOn && !clockOn;
  });
}

export function renderWeather(settings, weather) {
  const enabled = settings.showWeather && settings.latitude != null && settings.longitude != null;
  document.querySelectorAll('[data-weather]').forEach((node) => {
    node.hidden = !enabled;
    if (!enabled) {
      node.replaceChildren();
      return;
    }
    if (!weather) {
      node.innerHTML = '<div class="wx wx-pending"><p>Loading weather…</p></div>';
      return;
    }
    if (!weather.ok) {
      node.innerHTML = '<div class="wx wx-pending"><p>Weather unavailable</p></div>';
      return;
    }
    const unit = weather.units === 'fahrenheit' ? 'F' : 'C';
    const temp = Math.round(weather.temp);
    const humidity = Math.round(weather.humidity);
    const place = settings.locationLabel || '';
    const spoken = `${temp} degrees ${unit === 'F' ? 'Fahrenheit' : 'Celsius'}, ${weather.label}, ${humidity} percent humidity${place ? `, ${place}` : ''}`;
    node.innerHTML = `
      <div class="wx" role="img" aria-label="${escapeHtml(spoken)}">
        <div class="wx-icon">${weatherIcon(weather.code, weather.isDay)}</div>
        <div class="wx-copy">
          <div class="wx-temp">${temp}°<span>${unit}</span></div>
          <div class="wx-desc">${escapeHtml(weather.label)} · ${humidity}%</div>
          ${place ? `<div class="wx-place">${escapeHtml(place)}</div>` : ''}
        </div>
      </div>`;
  });
}

export function startClock(readSettings) {
  const tick = () => renderClock(readSettings());
  tick();
  setInterval(tick, 1000);
}
