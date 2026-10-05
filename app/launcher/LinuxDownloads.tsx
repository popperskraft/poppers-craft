import type { LauncherRelease } from "@/lib/launcher-releases";
import { linuxReleasesFor } from "@/lib/launcher-installers";

export function LinuxDownloads({ releases }: { releases: LauncherRelease[] }) {
  const [latest] = linuxReleasesFor(releases, "appimage");
  return (
    <article className="launcher-platform-card launcher-linux-card" data-platform="linux">
      <span>PLATFORM.EXE</span>
      <h2>Linux</h2>
      <p>AppImage для Linux на Intel / AMD (x86_64).</p>
      {latest ? (
        <a href={`/api/launcher/releases/${latest.id}/download`} download={latest.originalName}>СКАЧАТЬ ↗</a>
      ) : <button type="button" disabled>AppImage пока недоступен</button>}
      <small className="launcher-download-meta">{latest ? `v${latest.version} · ${(latest.size / 1_000_000).toFixed(1)} МБ` : "AppImage · x86_64"}</small>
    </article>
  );
}

export function LinuxAlternativeDownloads({ releases }: { releases: LauncherRelease[] }) {
  const [latest] = linuxReleasesFor(releases, "deb");
  return (
    <details className="launcher-linux-alternatives">
      <summary>Другие варианты установки Linux</summary>
      <section className="launcher-linux-option" aria-label="Ubuntu / Debian / Mint (.deb)">
        <h3>DEB · UBUNTU / DEBIAN / MINT</h3>
        <p>Установка через менеджер пакетов.</p>
        {latest ? (
          <>
            <a href={`/api/launcher/releases/${latest.id}/download`} download={latest.originalName}>Скачать DEB</a>
            <small>{`v${latest.version} · ${(latest.size / 1_000_000).toFixed(1)} МБ`}</small>
          </>
        ) : <button type="button" disabled>DEB пока недоступен</button>}
      </section>
    </details>
  );
}
