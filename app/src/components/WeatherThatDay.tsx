import { useEffect, useState } from 'react';

// Historical weather + golden hour for a PAST day at a place (Open-Meteo archive
// API, free, no key). Text only — no icons, per house style.
const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms',
  99: 'Thunderstorms',
};

interface W {
  hi: number;
  lo: number;
  code: number;
  sunrise: string;
  sunset: string;
}

const fmtTime = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';

/** `date` is a YYYY-MM-DD calendar day. Renders nothing until data loads / on error. */
export default function WeatherThatDay({
  lat,
  lng,
  date,
}: {
  lat: number;
  lng: number;
  date: string;
}) {
  const [w, setW] = useState<W | null>(null);
  useEffect(() => {
    let ok = true;
    setW(null);
    if (!lat && !lng) return;
    const day = date.slice(0, 10);
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
      `&start_date=${day}&end_date=${day}` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset` +
      `&temperature_unit=fahrenheit&timezone=auto`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const dy = d?.daily;
        if (!ok || !dy || dy.temperature_2m_max?.[0] == null) return;
        setW({
          hi: Math.round(dy.temperature_2m_max[0]),
          lo: Math.round(dy.temperature_2m_min[0]),
          code: dy.weather_code?.[0] ?? -1,
          sunrise: dy.sunrise?.[0] ?? '',
          sunset: dy.sunset?.[0] ?? '',
        });
      })
      .catch(() => undefined);
    return () => {
      ok = false;
    };
  }, [lat, lng, date]);

  if (!w) return null;
  const golden = w.sunset ? new Date(new Date(w.sunset).getTime() - 3600_000).toISOString() : '';
  return (
    <div className="weather-line">
      That day: {w.hi}° / {w.lo}°F{w.code >= 0 && WMO[w.code] ? ` · ${WMO[w.code]}` : ''}
      {w.sunset && (
        <>
          {' · '}Sunset {fmtTime(w.sunset)}
          {golden && <span className="weather-golden"> · golden hour ~{fmtTime(golden)}</span>}
        </>
      )}
    </div>
  );
}
