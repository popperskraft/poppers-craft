"use client";

import { useEffect, useState } from "react";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import type { MinecraftIconName } from "@/lib/minecraft-icons";

/* «Профиль → Настройки → Активные устройства»: где открыт аккаунт —
   браузеры, приложение и лаунчер. Любой сеанс, кроме этого, можно
   завершить: на том устройстве попросят войти заново. */

type Device = {
  id: string;
  current: boolean;
  kind: "launcher" | "phone" | "tablet" | "computer" | "unknown";
  label: string;
  ip: string;
  signedInAt: string;
  lastActiveAt: string;
};

const ICONS: Record<Device["kind"], MinecraftIconName> = {
  launcher: "grass",
  phone: "compass",
  tablet: "book",
  computer: "crafting_table",
  unknown: "ender_pearl",
};

const dateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" });
const when = (value: string) => (Number.isFinite(Date.parse(value)) ? dateTime.format(new Date(value)) : "—");

export function DevicesPanel() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/profile/sessions", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error);
        setDevices(result.devices as Device[]);
      })
      .catch((caught) => setError(caught instanceof Error && caught.message ? caught.message : "Не удалось загрузить устройства."));
  }, []);

  async function end(action: "end" | "end-others", id?: string) {
    if (action === "end-others" && !window.confirm("Выйти из аккаунта на всех других устройствах, включая лаунчер?")) return;
    setBusy(id ?? action);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/profile/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось завершить сеанс.");
      setDevices(result.devices as Device[]);
      setMessage(action === "end-others" ? "Вы вышли на всех других устройствах." : "Сеанс завершён.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось завершить сеанс.");
    } finally {
      setBusy("");
    }
  }

  if (!devices) return error ? <p className="form-message error-message">{error}</p> : <p>Загружаем…</p>;
  const others = devices.filter((device) => !device.current);
  return (
    <div className="devices-panel">
      <ul className="devices-list">
        {devices.map((device) => (
          <li className={device.current ? "is-current" : undefined} key={device.id}>
            <MinecraftIcon name={ICONS[device.kind]} size="md" />
            <div>
              <b>{device.label}</b>
              {device.current ? <span className="devices-current">ЭТО УСТРОЙСТВО</span> : null}
              <small>Последняя активность: {when(device.lastActiveAt)}</small>
              <small>Вход: {when(device.signedInAt)}{device.ip ? ` · IP ${device.ip}` : ""}</small>
            </div>
            {device.current ? null : (
              <button type="button" disabled={Boolean(busy)} onClick={() => void end("end", device.id)}>
                {busy === device.id ? "ЗАВЕРШАЕМ…" : "ЗАВЕРШИТЬ"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length ? (
        <div className="profile-actions">
          <button type="button" disabled={Boolean(busy)} onClick={() => void end("end-others")}>
            {busy === "end-others" ? "ВЫХОДИМ…" : "ВЫЙТИ НА ВСЕХ ДРУГИХ УСТРОЙСТВАХ"}
          </button>
        </div>
      ) : <p className="devices-note">Аккаунт открыт только здесь.</p>}
      <p className="devices-note">Не узнаёте устройство? Завершите сеанс и смените пароль. «Устройство без данных» — вход, сделанный до появления этого списка.</p>
      {message ? <p className="form-message success-message" role="status">{message}</p> : null}
      {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
    </div>
  );
}
