import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { linuxInstallerFor } from "./launcher-installers";

export const LAUNCHER_PLATFORMS = ["macos", "windows", "linux"] as const;

export type LauncherPlatform = (typeof LAUNCHER_PLATFORMS)[number];

export type LauncherRelease = {
  id: string;
  platform: LauncherPlatform;
  version: string;
  notes: string;
  originalName: string;
  storedName: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
  createdBy: string;
  archived: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
};

type UploadEvent = {
  type: "upload";
  release: Omit<LauncherRelease, "archived" | "archivedAt" | "archivedBy">;
};

type StateEvent = {
  type: "archive" | "restore";
  releaseId: string;
  at: string;
  by: string;
};

type LauncherEvent = UploadEvent | StateEvent;

const MAX_LAUNCHER_SIZE = 1_500_000_000;
const DEFAULT_PRODUCTION_STORAGE = "/home/stepan/popperscraft/launcher-storage";
const allowedExtensions: Record<LauncherPlatform, string[]> = {
  macos: [".dmg", ".zip"],
  windows: [".exe", ".msi", ".zip"],
  linux: [".appimage", ".deb", ".rpm", ".tar.gz", ".zip"],
};

function storageRoot() {
  const configured = process.env.POPPERSCRAFT_LAUNCHER_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") return DEFAULT_PRODUCTION_STORAGE;
  return path.join(process.cwd(), ".launcher-storage");
}

function filesRoot() {
  return path.join(storageRoot(), "files");
}

function eventsPath() {
  return path.join(storageRoot(), "events.jsonl");
}

function isPlatform(value: string): value is LauncherPlatform {
  return LAUNCHER_PLATFORMS.includes(value as LauncherPlatform);
}

function cleanFileName(value: string) {
  return path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
}

function fileExtension(platform: LauncherPlatform, fileName: string) {
  const lower = fileName.toLowerCase();
  return allowedExtensions[platform]
    .sort((left, right) => right.length - left.length)
    .find((extension) => lower.endsWith(extension)) ?? null;
}

function contentTypeFor(extension: string) {
  if (extension === ".dmg") return "application/x-apple-diskimage";
  if (extension === ".exe") return "application/vnd.microsoft.portable-executable";
  if (extension === ".msi") return "application/x-msi";
  if (extension === ".appimage") return "application/octet-stream";
  if (extension === ".deb") return "application/vnd.debian.binary-package";
  if (extension === ".rpm") return "application/x-rpm";
  if (extension === ".tar.gz") return "application/gzip";
  if (extension === ".zip") return "application/zip";
  return "application/octet-stream";
}

function isUploadEvent(value: unknown): value is UploadEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<UploadEvent>;
  const release = event.release as Partial<UploadEvent["release"]> | undefined;
  return event.type === "upload"
    && Boolean(release)
    && typeof release?.id === "string"
    && typeof release.platform === "string"
    && isPlatform(release.platform)
    && typeof release.version === "string"
    && typeof release.originalName === "string"
    && typeof release.storedName === "string"
    && typeof release.size === "number"
    && typeof release.sha256 === "string"
    && typeof release.createdAt === "string";
}

function isStateEvent(value: unknown): value is StateEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<StateEvent>;
  return (event.type === "archive" || event.type === "restore")
    && typeof event.releaseId === "string"
    && typeof event.at === "string"
    && typeof event.by === "string";
}

async function readEvents(): Promise<LauncherEvent[]> {
  let source = "";
  try {
    source = await readFile(eventsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return source
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return isUploadEvent(parsed) || isStateEvent(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

async function appendEvent(event: LauncherEvent) {
  await mkdir(storageRoot(), { recursive: true, mode: 0o750 });
  await appendFile(eventsPath(), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o640 });
}

export async function listLauncherReleases({ includeArchived = false } = {}) {
  const releases = new Map<string, LauncherRelease>();
  for (const event of await readEvents()) {
    if (event.type === "upload") {
      releases.set(event.release.id, {
        ...event.release,
        archived: false,
        archivedAt: null,
        archivedBy: null,
      });
      continue;
    }

    const release = releases.get(event.releaseId);
    if (!release) continue;
    releases.set(event.releaseId, {
      ...release,
      archived: event.type === "archive",
      archivedAt: event.type === "archive" ? event.at : null,
      archivedBy: event.type === "archive" ? event.by : null,
    });
  }

  return [...releases.values()]
    .filter((release) => includeArchived || !release.archived)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function storeLauncherRelease({
  platform,
  installer,
  version,
  notes,
  originalName,
  body,
  createdBy,
  declaredSize,
}: {
  platform: string;
  installer?: string;
  version: string;
  notes: string;
  originalName: string;
  body: ReadableStream<Uint8Array> | null;
  createdBy: string;
  declaredSize: number | null;
}): Promise<LauncherRelease> {
  if (!isPlatform(platform)) throw new Error("Выберите macOS, Windows или Linux.");
  const normalizedVersion = version.trim().slice(0, 40);
  const normalizedNotes = notes.trim().slice(0, 500);
  const normalizedName = cleanFileName(originalName);
  const extension = fileExtension(platform, normalizedName);
  if (normalizedVersion.length < 1) throw new Error("Укажите номер версии.");
  if (!normalizedName || !extension) {
    throw new Error(`Для ${platform} выбран неподдерживаемый формат файла.`);
  }
  // Existing journal entries and older clients still work. New Linux uploads
  // explicitly identify the slot so the wrong file cannot replace that format.
  if (installer && (platform !== "linux" || !["deb", "appimage"].includes(installer))) {
    throw new Error("Выберите формат Linux: DEB или AppImage.");
  }
  if (installer && linuxInstallerFor({ platform, originalName: normalizedName }) !== installer) {
    throw new Error(installer === "deb" ? "Для Linux DEB выберите файл .deb." : "Для Linux AppImage выберите файл .AppImage.");
  }
  if (!body) throw new Error("Выберите файл лаунчера.");
  if (declaredSize !== null && (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > MAX_LAUNCHER_SIZE)) {
    throw new Error("Файл должен быть не больше 1,5 ГБ.");
  }

  const id = randomUUID();
  const storedName = `${id}${extension}`;
  const uploadingName = `${storedName}.uploading`;
  await mkdir(filesRoot(), { recursive: true, mode: 0o750 });

  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_LAUNCHER_SIZE) {
        callback(new Error("Файл больше допустимых 1,5 ГБ."));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  const source = Readable.fromWeb(body as never);
  await pipeline(
    source,
    meter,
    createWriteStream(path.join(filesRoot(), uploadingName), { flags: "wx", mode: 0o640 }),
  );
  if (size < 1) throw new Error("Загруженный файл пуст.");
  if (declaredSize !== null && size !== declaredSize) throw new Error("Файл загрузился не полностью. Попробуйте ещё раз.");

  await rename(path.join(filesRoot(), uploadingName), path.join(filesRoot(), storedName));
  const createdAt = new Date().toISOString();
  const releaseBase: UploadEvent["release"] = {
    id,
    platform,
    version: normalizedVersion,
    notes: normalizedNotes,
    originalName: normalizedName,
    storedName,
    contentType: contentTypeFor(extension),
    size,
    sha256: hash.digest("hex"),
    createdAt,
    createdBy,
  };
  await appendEvent({ type: "upload", release: releaseBase });
  return { ...releaseBase, archived: false, archivedAt: null, archivedBy: null };
}

export async function setLauncherReleaseArchived(releaseId: string, archived: boolean, actor: string) {
  const id = releaseId.trim();
  const release = (await listLauncherReleases({ includeArchived: true })).find((item) => item.id === id);
  if (!release) return null;
  if (release.archived === archived) return release;
  await appendEvent({
    type: archived ? "archive" : "restore",
    releaseId: id,
    at: new Date().toISOString(),
    by: actor,
  });
  return { ...release, archived, archivedAt: archived ? new Date().toISOString() : null, archivedBy: archived ? actor : null };
}

export async function getActiveLauncherRelease(releaseId: string) {
  return (await listLauncherReleases()).find((release) => release.id === releaseId) ?? null;
}

export async function launcherReleaseFile(release: LauncherRelease) {
  const root = path.resolve(filesRoot());
  const filePath = path.resolve(root, release.storedName);
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error("Недопустимый путь файла.");
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Файл версии не найден.");
  return { filePath, fileStat, stream: (start?: number, end?: number) => createReadStream(filePath, { start, end }) };
}
