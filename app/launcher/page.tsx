import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BackButton } from "@/app/BackButton";
import { LauncherDownloads } from "./LauncherDownloads";
import { LinuxDownloads, LinuxAlternativeDownloads } from "./LinuxDownloads";
import { getApprovedMember } from "@/lib/waitlist";
import { hasServerAccess } from "@/lib/payments";
import {
  listLauncherReleases,
  type LauncherPlatform,
  type LauncherRelease,
} from "@/lib/launcher-releases";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Скачать лаунчер — PoppersCraft",
  description: "Лаунчер PoppersCraft для macOS, Windows и Linux. Инструкция по установке и требования к компьютеру.",
};

const macUrl = process.env.NEXT_PUBLIC_LAUNCHER_MAC_URL?.trim()
  || "https://cdn.popperscraft.org/launcher/app/PoppersCraft-Launcher-macOS.dmg";
const windowsUrl = process.env.NEXT_PUBLIC_LAUNCHER_WINDOWS_URL?.trim()
  || "https://cdn.popperscraft.org/launcher/app/PoppersCraft-Launcher-Windows.exe";

function formatBytes(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(value / 1_000))} КБ`;
}

function releaseUrl(release: LauncherRelease) {
  return `/api/launcher/releases/${release.id}/download`;
}

function DownloadCard({
  platform,
  name,
  note,
  url,
  fileName,
  releases,
}: {
  platform: LauncherPlatform;
  name: string;
  note: string;
  url: string;
  fileName: string;
  releases: LauncherRelease[];
}) {
  if (platform === "linux") return <LinuxDownloads releases={releases} />;
  const [latest] = releases;
  return (
    /* data-platform — по нему LauncherDownloads узнаёт, какую инструкцию показать. */
    <article className="launcher-platform-card" data-platform={platform}>
      <span>PLATFORM.EXE</span>
      <h2>{name}</h2>
      <p>{note}</p>
      {latest ? (
        <a href={releaseUrl(latest)} download={latest.originalName}>СКАЧАТЬ ↗</a>
      ) : url ? (
        <a href={url} download={fileName}>СКАЧАТЬ ↗</a>
      ) : <button type="button" disabled>ФАЙЛ ГОТОВИТСЯ</button>}
      <small className="launcher-download-meta">{latest ? `v${latest.version} · ${formatBytes(latest.size)}` : platform === "macos" ? "DMG" : "EXE"}</small>
    </article>
  );
}

export default async function LauncherPage() {
  const releases = await listLauncherReleases();
  /* Лаунчер ставится только на компьютер: с телефона на эту страницу не
     попасть, ссылки на неё там тоже скрыты (text-containment.css, раздел 23). */
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (/iPhone|iPod|Android.+Mobile|Windows Phone|webOS|BlackBerry/i.test(userAgent)) redirect("/");
  const forPlatform = (platform: LauncherPlatform) => releases.filter((release) => release.platform === platform);
  const macReleases = forPlatform("macos");
  const windowsReleases = forPlatform("windows");
  const linuxReleases = forPlatform("linux");
  /* Анкета одобрена, но пропуска нет — лаунчер не пустит на сервер. */
  const member = await getApprovedMember().catch(() => null);
  const needsPass = member ? !(await hasServerAccess(member.userId)) : false;
  return (
    <main className="launcher-page">
      <header className="launcher-topbar">
        <BackButton fallback="/members" />
      </header>

      <section className="paint-window launcher-hero">
        <div className="window-bar"><span>popperscraft_launcher_setup.exe</span><i aria-hidden="true">×</i></div>
        <div>
          <p className="kicker">ЗАЙТИ В МИР</p>
          <h1>СКАЧАТЬ ЛАУНЧЕР</h1>
          <p>Выберите свою систему. Ник в лаунчере должен совпадать с ником на платформе и на сервере.</p>
          {needsPass ? <p className="launcher-pass-note" style={{ padding: "10px 12px", border: "3px solid #000", background: "#fff2a6", color: "#15151a" }}><b>Нужен пропуск.</b> Анкета одобрена, но чтобы зайти на сервер, оплатите пропуск POPPERSCRAFT — 499 ₽ один раз. <Link href="/donation?plan=pass">Оплатить →</Link></p> : null}
        </div>
      </section>

      {/* Видео-инструкция появляется под карточками после нажатия «Скачать». */}
      <LauncherDownloads>
        <DownloadCard platform="macos" name="macOS" note="Для macOS на Intel и Apple Silicon. Установщик DMG." url={macUrl} fileName="PoppersCraft-Launcher-macOS.dmg" releases={macReleases} />
        <DownloadCard platform="windows" name="Windows" note="Для Windows 10 и 11. Установщик EXE." url={windowsUrl} fileName="PoppersCraft-Launcher-Windows.exe" releases={windowsReleases} />
        <DownloadCard platform="linux" name="Linux" note="" url="" fileName="" releases={linuxReleases} />
      </LauncherDownloads>
      <div className="launcher-alternative-downloads">
        <LinuxAlternativeDownloads releases={linuxReleases} />
      </div>

      <section className="launcher-guides">
        <article className="paint-window launcher-guide">
          <div className="window-bar"><span>install_windows_linux.txt</span></div>
          <h2>WINDOWS И LINUX</h2>
          <p><b>Windows:</b> скачайте установщик, запустите его и следуйте шагам на экране. Если SmartScreen покажет предупреждение, сначала проверьте имя файла и адрес сайта.</p>
          <p><b>Linux AppImage:</b> <span>дайте файлу право на запуск в его свойствах или командой</span> <code>chmod +x</code>, <span>затем откройте файл.</span></p>
          <p><b>Linux DEB:</b> <span>для Ubuntu, Debian и Mint скачайте .deb и откройте его через менеджер пакетов.</span></p>
          <p>Оба варианта Linux предназначены для 64-битных Intel / AMD (x86_64), не для ARM.</p>
        </article>
      </section>

      <section className="paint-window launcher-requirements">
        <div className="window-bar"><span>recommended_hardware.ini</span></div>
        <h2>ЧТО НУЖНО ДЛЯ ИГРЫ</h2>
        <div>
          <article><h3>МИНИМУМ</h3><p>4-ядерный процессор, 8 ГБ ОЗУ, видеокарта с поддержкой OpenGL 4.5 и 6 ГБ свободного места.</p></article>
          <article><h3>РЕКОМЕНДУЕМ</h3><p>6-ядерный процессор, 16 ГБ ОЗУ, отдельная видеокарта и SSD. Для шейдеров понадобится более мощная видеокарта.</p></article>
        </div>
        <p>Скорость зависит от дальности прорисовки, шейдеров и фоновых программ.</p>
      </section>

      <footer className="launcher-footer"><Link href="/rules">ПРАВИЛА</Link><a href="https://t.me/PoppersCraftAuthBot" target="_blank" rel="noreferrer">ПОМОЩЬ В TELEGRAM ↗</a></footer>
    </main>
  );
}
