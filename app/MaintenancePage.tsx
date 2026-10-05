import Link from "next/link";
import { MinecraftIcon } from "./MinecraftIcon";
import Image from "next/image";
import { MaintenanceCountdown } from "./MaintenanceCountdown";

export function MaintenancePage({ endsAt }: { endsAt: string | null }) {
  return (
    <main className="maintenance-shell">
      <div className="desktop-noise" aria-hidden="true" />
      <section className="paint-window maintenance-window">
        <div className="window-bar">
          <span className="window-title-with-icon">
            <MinecraftIcon name="redstone" size="sm" /> server_status.exe
          </span>
        </div>
        <div className="maintenance-content">
          <Image
            className="maintenance-potion"
            src="/maintenance-potion-v2.png"
            width={256}
            height={256}
            alt="Пиксельное зелье"
            priority
          />
          <p className="maintenance-code">STATUS: 503 · ВРЕМЕННО НЕДОСТУПЕН</p>
          <h1>ТЕХНИЧЕСКИЕ<br />РАБОТЫ</h1>
          <p>
            Сейчас обновляем сайт и сервер.<br />
            Откроем, как только закончим.
          </p>
          {endsAt ? <MaintenanceCountdown endsAt={endsAt} /> : null}
          <div className="maintenance-progress" aria-label="Технические работы выполняются">
            <span />
          </div>
          <small>Можно заглянуть сюда чуть позже.</small>
        </div>
      </section>
      <Link className="maintenance-admin-link" href="/admin">
        вход для админов
      </Link>
    </main>
  );
}
