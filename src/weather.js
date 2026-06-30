// Open-Meteo: gratis weer-API zonder key, met CORS. Geocoding eerst (plaatsnaam → lat/lon),
// dan forecast voor de gekozen periode. Resultaten 6u gecached in localStorage.
const CACHE_PREFIX = 'paklijst:weather:';
const CACHE_TTL_MS = 6 * 3600 * 1000;

const WMO_ICON = [
  [0, '☀️'],
  [2, '🌤️'],
  [3, '☁️'],
  [48, '🌫️'],
  [57, '🌦️'],
  [67, '🌧️'],
  [77, '❄️'],
  [82, '🌦️'],
  [99, '⛈️'],
];
export function weatherIcon(code) {
  if (code == null) return '';
  for (const [max, icon] of WMO_ICON) if (code <= max) return icon;
  return '🌡️';
}

export async function fetchWeather(destination, departure, returnDate) {
  if (!destination?.trim() || !departure) return null;
  const start = departure;
  const end = returnDate || departure;
  // Open-Meteo daily forecast horizon = 16 dagen vanaf vandaag
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(start + 'T00:00:00');
  const diff = Math.round((startDate - today) / 86400000);
  if (diff < 0 || diff > 15) return { tooFar: true };

  const key = CACHE_PREFIX + `${destination.toLowerCase()}|${start}|${end}`;
  try {
    const c = localStorage.getItem(key);
    if (c) {
      const p = JSON.parse(c);
      if (Date.now() - p.ts < CACHE_TTL_MS) return p.data;
    }
  } catch {
    /* corrupt cache negeren */
  }

  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        destination.trim()
      )}&count=1&language=nl&format=json`
    ).then((r) => r.json());
    if (!geo.results?.[0]) return { notFound: true };
    const g = geo.results[0];
    const params = new URLSearchParams({
      latitude: g.latitude,
      longitude: g.longitude,
      daily: 'temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max',
      timezone: 'auto',
      start_date: start,
      end_date: end,
    });
    const fc = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`).then((r) => r.json());
    if (!fc.daily?.time?.length) return null;
    const days = fc.daily.time.map((d, i) => ({
      date: d,
      tmax: Math.round(fc.daily.temperature_2m_max[i]),
      tmin: Math.round(fc.daily.temperature_2m_min[i]),
      code: fc.daily.weathercode[i],
      pop: fc.daily.precipitation_probability_max?.[i] ?? null,
    }));
    const tmax = Math.max(...days.map((d) => d.tmax));
    const tmin = Math.min(...days.map((d) => d.tmin));
    const wetDays = days.filter((d) => (d.pop ?? 0) >= 60 || (d.code >= 51 && d.code <= 82)).length;
    const data = {
      place: g.country ? `${g.name}, ${g.country}` : g.name,
      tmax,
      tmin,
      wetDays,
      days,
    };
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (e) {
    console.warn('[weather] fetch failed', e);
    return null;
  }
}
