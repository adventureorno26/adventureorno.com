import { useEffect, useState } from 'react';

// Compact current-conditions + golden-hour line for a place (Open-Meteo, free,
// no key). Text only — no icons, per house style.
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
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms',
  99: 'Thunderstorms',
};

interface W {
  temp: number;
  code: number;
  sunset: string;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function WeatherLine({ lat, lng }: { lat: number; lng: number }) {
  const [w, setW] = useState<W | null>(null);
  useEffect(() => {
    let ok = true;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weather_code&daily=sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ok || !d?.current) return;
        setW({
          temp: Math.round(d.current.temperature_2m),
          code: d.current.weather_code,
          sunset: d.daily?.sunset?.[0] ?? '',
        });
      })
      .catch(() => undefined);
    return () => {
      ok = false;
    };
  }, [lat, lng]);

  if (!w) return null;
  // Golden hour ≈ the hour before sunset.
  const golden = w.sunset ? new Date(new Date(w.sunset).getTime() - 3600_000).toISOString() : '';
  return (
    <div className="weather-line">
      {w.temp}°F · {WMO[w.code] ?? 'Now'}
      {w.sunset && (
        <>
          {' '}
          · Sunset {fmtTime(w.sunset)}
          {golden && <span className="weather-golden"> · golden hour ~{fmtTime(golden)}</span>}
        </>
      )}
    </div>
  );
}
