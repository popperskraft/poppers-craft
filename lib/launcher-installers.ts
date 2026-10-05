// Shared by the public downloads and the upload form; no server-only imports.
export const LINUX_INSTALLERS = ["deb", "appimage"] as const;
export type LinuxInstaller = (typeof LINUX_INSTALLERS)[number];

export function linuxInstallerFor(release: { platform: string; originalName: string }): LinuxInstaller | null {
  if (release.platform !== "linux") return null;
  const name = release.originalName.toLowerCase();
  if (name.endsWith(".deb")) return "deb";
  if (name.endsWith(".appimage")) return "appimage";
  return null;
}

export function linuxReleasesFor<T extends { platform: string; originalName: string; archived: boolean; createdAt: string }>(releases: T[], installer: LinuxInstaller): T[] {
  return releases.filter((release) => !release.archived && linuxInstallerFor(release) === installer)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export const launcherUploadTargets = {
  macos: { platform: "macos", name: "macOS", accept: ".dmg,.zip", installer: "" },
  windows: { platform: "windows", name: "Windows", accept: ".exe,.msi,.zip", installer: "" },
  deb: { platform: "linux", name: "Linux · DEB", accept: ".deb", installer: "deb" },
  appimage: { platform: "linux", name: "Linux · AppImage", accept: ".AppImage", installer: "appimage" },
} as const;
export type LauncherUploadTarget = keyof typeof launcherUploadTargets;

export function launcherReleaseLabel(release: { platform: string; originalName: string }) {
  const target = linuxInstallerFor(release) ?? release.platform;
  return launcherUploadTargets[target as LauncherUploadTarget]?.name ?? "Linux";
}
