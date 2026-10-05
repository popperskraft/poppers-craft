"use client";

import { useEffect, useState } from "react";

function remaining(endsAt: string) {
  const distance = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const seconds = Math.floor(distance / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return { distance, days, hours, minutes, secs };
}

export function MaintenanceCountdown({ endsAt }: { endsAt: string }) {
  const [time, setTime] = useState(() => remaining(endsAt));

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = remaining(endsAt);
      setTime(next);
      if (next.distance === 0) {
        window.clearInterval(timer);
        window.location.reload();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  return (
    <div className="maintenance-countdown" aria-live="polite">
      <span><b>{String(time.days).padStart(2, "0")}</b><small>ДНЕЙ</small></span>
      <i>:</i>
      <span><b>{String(time.hours).padStart(2, "0")}</b><small>ЧАСОВ</small></span>
      <i>:</i>
      <span><b>{String(time.minutes).padStart(2, "0")}</b><small>МИНУТ</small></span>
      <i>:</i>
      <span><b>{String(time.secs).padStart(2, "0")}</b><small>СЕКУНД</small></span>
    </div>
  );
}
