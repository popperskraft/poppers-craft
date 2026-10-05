import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { gunzipSync } from "node:zlib";

/* Статус «в игре» и статистика игроков — прямо из данных сервера Minecraft.

   Сервер работает на той же машине, его папка /data смонтирована из
   /opt/pc/data. Отсюда читается только то, что сервер ведёт сам:
   - кто сейчас в игре — Server List Ping (как список серверов в игре) и
     журнал latest.log;
   - наигранное время и добытые алмазы — ванильная статистика
     world/stats/<uuid>.json (сервер сохраняет её раз в несколько минут
     и при выходе игрока);
   - календарь активности — входы и выходы из журналов logs/*.log.gz.
   Ничего не записывается, мод на сервер ставить не нужно. */

const DATA_DIR = process.env.MINECRAFT_DATA_DIR || "/opt/pc/data";
const STATUS_HOST = process.env.MINECRAFT_STATUS_HOST || "127.0.0.1";
const STATUS_PORT = Number(process.env.MINECRAFT_STATUS_PORT || 25565);
/* Дни календаря считаются по Москве (UTC+3, без перехода на летнее время). */
const DAY_OFFSET_MS = Number(process.env.MINECRAFT_STATS_TZ_OFFSET_MINUTES ?? 180) * 60_000;
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ServerStatus = {
  reachable: boolean;
  onlineCount: number;
  maxPlayers: number;
  /** Ники в нижнем регистре — так они хранятся в логинах сайта. */
  online: string[];
};

export type PlayerGameStats = {
  playMinutes: number;
  diamondsMined: number;
  diamondsCollected: number;
  blocksMined: number;
  mobKills: number;
  deaths: number;
  distanceKm: number;
};

export type PlayerActivity = {
  firstSeen: string | null;
  lastSeen: string | null;
  activeDays: number;
  totalMinutes: number;
  /** Минуты по дням (YYYY-MM-DD по Москве), только дни с игрой. */
  days: Record<string, number>;
};

// ---------- Server List Ping ----------

function writeVarInt(value: number) {
  const bytes: number[] = [];
  let rest = value >>> 0;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest) byte |= 0x80;
    bytes.push(byte);
  } while (rest);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset: number): [value: number, size: number] | null {
  let value = 0;
  for (let size = 0; size < 5; size += 1) {
    if (offset + size >= buffer.length) return null;
    const byte = buffer[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    if (!(byte & 0x80)) return [value, size + 1];
  }
  return null;
}

function packet(id: number, payload: Buffer) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function pingServer(timeoutMs = 1500): Promise<{ online: number; max: number; sample: string[] } | null> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: STATUS_HOST, port: STATUS_PORT });
    let chunks = Buffer.alloc(0);
    let settled = false;
    const finish = (result: { online: number; max: number; sample: string[] } | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on("error", () => finish(null));
    socket.on("connect", () => {
      const host = Buffer.from(STATUS_HOST, "utf8");
      const port = Buffer.alloc(2);
      port.writeUInt16BE(STATUS_PORT);
      const handshake = Buffer.concat([writeVarInt(767), writeVarInt(host.length), host, port, writeVarInt(1)]);
      socket.write(packet(0x00, handshake));
      socket.write(packet(0x00, Buffer.alloc(0)));
    });
    socket.on("data", (data) => {
      chunks = Buffer.concat([chunks, data]);
      const length = readVarInt(chunks, 0);
      if (!length || chunks.length < length[1] + length[0]) return;
      let offset = length[1];
      const id = readVarInt(chunks, offset);
      if (!id || id[0] !== 0x00) return finish(null);
      offset += id[1];
      const jsonLength = readVarInt(chunks, offset);
      if (!jsonLength) return finish(null);
      offset += jsonLength[1];
      try {
        const json = JSON.parse(chunks.subarray(offset, offset + jsonLength[0]).toString("utf8"));
        const sample = Array.isArray(json?.players?.sample)
          ? json.players.sample.map((player: { name?: unknown }) => String(player?.name ?? "")).filter(Boolean)
          : [];
        finish({ online: Number(json?.players?.online) || 0, max: Number(json?.players?.max) || 0, sample });
      } catch {
        finish(null);
      }
    });
  });
}

// ---------- Журналы ----------

type LogEvent = { at: number; kind: "join" | "leave" | "stop" | "start" | "mark"; name: string };

const TIME_RE = /^\[(\d{2}):(\d{2}):(\d{2})\]/;
/* Перед ником может стоять префикс мода, например «[AFK] platon left the game». */
const JOIN_RE = /\]: (?:\[[^\]]*\]\s*)*([A-Za-z0-9_.\-]{1,32}) joined the game\s*$/;
const LEAVE_RE = /\]: (?:\[[^\]]*\]\s*)*([A-Za-z0-9_.\-]{1,32}) left the game\s*$/;
const STOP_RE = /\]: Stopping server/;
const START_RE = /\]: Starting minecraft server/;

function parseLog(text: string, baseDayUtc: number, reverse: boolean): LogEvent[] {
  const lines = text.split(/\r?\n/);
  const events: LogEvent[] = [];
  /* Время в строках без даты: день берётся из имени файла (или даты изменения
     для latest.log) и сдвигается, когда часы «перескакивают» полночь. */
  let day = baseDayUtc;
  let previous = reverse ? Infinity : -Infinity;
  let lastLineAt: number | null = null;
  const order = reverse ? [...lines].reverse() : lines;
  for (const line of order) {
    const time = TIME_RE.exec(line);
    if (!time) continue;
    const seconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
    if (!reverse && seconds < previous) day += DAY_MS;
    if (reverse && seconds > previous) day -= previous === Infinity ? 0 : DAY_MS;
    previous = seconds;
    const at = day + seconds * 1000;
    if (!reverse || lastLineAt === null) lastLineAt = reverse ? at : Math.max(lastLineAt ?? at, at);
    const join = JOIN_RE.exec(line);
    if (join) { events.push({ at, kind: "join", name: join[1].toLowerCase() }); continue; }
    const leave = LEAVE_RE.exec(line);
    if (leave) { events.push({ at, kind: "leave", name: leave[1].toLowerCase() }); continue; }
    if (STOP_RE.test(line)) { events.push({ at, kind: "stop", name: "" }); continue; }
    if (START_RE.test(line)) events.push({ at, kind: "start", name: "" });
  }
  const ordered = reverse ? events.reverse() : events;
  /* Последняя строка файла — последний признак жизни сервера перед
     перезапуском: по ней закрываются сессии, если сервер упал. */
  if (lastLineAt !== null) ordered.push({ at: lastLineAt, kind: "mark", name: "" });
  return ordered;
}

function dayKey(utcMs: number) {
  return new Date(Math.floor((utcMs + DAY_OFFSET_MS) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

function addSession(target: Map<string, PlayerActivity>, name: string, start: number, end: number) {
  if (end <= start) return;
  const entry = target.get(name) ?? { firstSeen: null, lastSeen: null, activeDays: 0, totalMinutes: 0, days: {} };
  let cursor = start;
  while (cursor < end) {
    const localDayEnd = (Math.floor((cursor + DAY_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - DAY_OFFSET_MS;
    const sliceEnd = Math.min(end, localDayEnd);
    const minutes = (sliceEnd - cursor) / 60_000;
    const key = dayKey(cursor);
    entry.days[key] = (entry.days[key] ?? 0) + minutes;
    entry.totalMinutes += minutes;
    cursor = sliceEnd;
  }
  const first = new Date(start).toISOString();
  const last = new Date(end).toISOString();
  if (!entry.firstSeen || first < entry.firstSeen) entry.firstSeen = first;
  if (!entry.lastSeen || last > entry.lastSeen) entry.lastSeen = last;
  target.set(name, entry);
}

let activityCache: { at: number; value: Map<string, PlayerActivity>; online: string[] } | null = null;

async function readActivity() {
  if (activityCache && Date.now() - activityCache.at < 5 * 60_000) return activityCache;
  const logsDir = path.join(DATA_DIR, "logs");
  const files = (await readdir(logsDir).catch(() => [] as string[]))
    .filter((name) => /^\d{4}-\d{2}-\d{2}-\d+\.log\.gz$/.test(name))
    .sort((a, b) => {
      const [dateA, indexA] = [a.slice(0, 10), Number(a.slice(11).split(".")[0])];
      const [dateB, indexB] = [b.slice(0, 10), Number(b.slice(11).split(".")[0])];
      return dateA === dateB ? indexA - indexB : dateA < dateB ? -1 : 1;
    });

  const events: LogEvent[] = [];
  for (const file of files) {
    try {
      const text = gunzipSync(await readFile(path.join(logsDir, file))).toString("utf8");
      events.push(...parseLog(text, Date.parse(`${file.slice(0, 10)}T00:00:00Z`), false));
    } catch {
      // Повреждённый архив журнала пропускаем — остальные дни посчитаются.
    }
  }
  const latestPath = path.join(logsDir, "latest.log");
  const latestInfo = await stat(latestPath).catch(() => null);
  if (latestInfo) {
    const text = await readFile(latestPath, "utf8").catch(() => "");
    const modified = latestInfo.mtimeMs;
    events.push(...parseLog(text, Math.floor(modified / DAY_MS) * DAY_MS, true));
  }

  const activity = new Map<string, PlayerActivity>();
  const open = new Map<string, number>();
  let lastAt = 0;
  for (const event of events) {
    const previousAt = lastAt;
    lastAt = Math.max(lastAt, event.at);
    if (event.kind === "stop" || event.kind === "start") {
      /* Остановка закрывает сессии в момент остановки. Запуск без остановки
         перед ним — это падение сервера: сессии закрываются последним
         событием перед падением, а не временем нового запуска. */
      const end = event.kind === "stop" ? event.at : previousAt;
      for (const [name, start] of open) addSession(activity, name, start, Math.max(start, end));
      open.clear();
    } else if (event.kind === "mark") {
      continue;
    } else if (event.kind === "join") {
      if (!open.has(event.name)) open.set(event.name, event.at);
    } else {
      const start = open.get(event.name);
      if (start !== undefined) addSession(activity, event.name, start, event.at);
      open.delete(event.name);
    }
  }
  /* Кто зашёл и ещё не вышел — в игре сейчас; их сессия идёт до «сейчас». */
  const now = Date.now();
  for (const [name, start] of open) addSession(activity, name, start, Math.max(now, lastAt));
  for (const entry of activity.values()) {
    entry.activeDays = Object.keys(entry.days).length;
    entry.totalMinutes = Math.round(entry.totalMinutes);
    for (const key of Object.keys(entry.days)) entry.days[key] = Math.max(1, Math.round(entry.days[key]));
  }
  activityCache = { at: Date.now(), value: activity, online: [...open.keys()] };
  return activityCache;
}

// ---------- Публичные функции ----------

let statusCache: { at: number; value: ServerStatus } | null = null;

/** Кто сейчас на сервере. Кэш — 15 секунд. */
export async function getServerStatus(): Promise<ServerStatus> {
  if (statusCache && Date.now() - statusCache.at < 15_000) return statusCache.value;
  const ping = await pingServer();
  let value: ServerStatus;
  if (!ping) {
    value = { reachable: false, onlineCount: 0, maxPlayers: 0, online: [] };
  } else {
    let names = ping.sample.map((name) => name.toLowerCase()).filter((name) => name !== "anonymous player");
    /* В ответе на пинг сервер показывает не больше 12 ников — остальных
       добираем из журнала. */
    if (ping.online > names.length) {
      activityCache = null;
      const { online } = await readActivity();
      names = [...new Set([...names, ...online])];
    }
    if (ping.online === 0) names = [];
    value = { reachable: true, onlineCount: ping.online, maxPlayers: ping.max, online: names };
  }
  statusCache = { at: Date.now(), value };
  return value;
}

export async function isPlayerOnline(login: string) {
  return (await getServerStatus()).online.includes(login.trim().toLowerCase());
}

function offlineUuid(name: string) {
  const bytes = createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUID игрока: из usercache.json сервера, иначе офлайн-UUID по нику. */
async function resolveUuids(login: string) {
  const wanted = login.trim().toLowerCase();
  const found: string[] = [];
  try {
    const cache = JSON.parse(await readFile(path.join(DATA_DIR, "usercache.json"), "utf8")) as Array<{ name?: string; uuid?: string }>;
    for (const entry of cache) {
      if (String(entry.name ?? "").toLowerCase() === wanted && UUID_RE.test(String(entry.uuid ?? ""))) found.push(String(entry.uuid));
    }
  } catch {
    // Кэша нет — посчитаем UUID сами.
  }
  found.push(offlineUuid(login.trim()));
  return [...new Set(found)];
}

function sumStat(group: Record<string, number> | undefined, keys: string[]) {
  return keys.reduce((total, key) => total + (Number(group?.[key]) || 0), 0);
}

/** Ванильная статистика игрока. Если ник заходил под разным регистром букв, файлы складываются. */
export async function getPlayerGameStats(login: string): Promise<PlayerGameStats | null> {
  const uuids = await resolveUuids(login);
  const files = (await Promise.all(uuids.map(async (uuid) => {
    try {
      return JSON.parse(await readFile(path.join(DATA_DIR, "world", "stats", `${uuid}.json`), "utf8")) as { stats?: Record<string, Record<string, number>> };
    } catch {
      return null;
    }
  }))).filter((file): file is { stats?: Record<string, Record<string, number>> } => Boolean(file?.stats));
  if (!files.length) return null;

  const total: PlayerGameStats = { playMinutes: 0, diamondsMined: 0, diamondsCollected: 0, blocksMined: 0, mobKills: 0, deaths: 0, distanceKm: 0 };
  for (const { stats = {} } of files) {
    const custom = stats["minecraft:custom"];
    total.playMinutes += Math.round((Number(custom?.["minecraft:play_time"]) || 0) / 20 / 60);
    total.diamondsMined += sumStat(stats["minecraft:mined"], ["minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"]);
    total.diamondsCollected += sumStat(stats["minecraft:picked_up"], ["minecraft:diamond"]);
    total.blocksMined += Object.values(stats["minecraft:mined"] ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
    total.mobKills += Number(custom?.["minecraft:mob_kills"]) || 0;
    total.deaths += Number(custom?.["minecraft:deaths"]) || 0;
    const centimeters = sumStat(custom, [
      "minecraft:walk_one_cm", "minecraft:sprint_one_cm", "minecraft:crouch_one_cm", "minecraft:swim_one_cm",
      "minecraft:fly_one_cm", "minecraft:boat_one_cm", "minecraft:horse_one_cm", "minecraft:minecart_one_cm",
      "minecraft:walk_on_water_one_cm", "minecraft:walk_under_water_one_cm", "minecraft:climb_one_cm", "minecraft:fall_one_cm",
    ]);
    total.distanceKm += centimeters / 100_000;
  }
  total.distanceKm = Math.round(total.distanceKm * 10) / 10;
  return total;
}

/** Календарь активности по журналам сервера. Кэш разбора — 5 минут. */
export async function getPlayerActivity(login: string): Promise<PlayerActivity> {
  const { value } = await readActivity();
  return value.get(login.trim().toLowerCase()) ?? { firstSeen: null, lastSeen: null, activeDays: 0, totalMinutes: 0, days: {} };
}

/** One cached log read for the directory; return only its already-visible players. */
export async function getPlayersLastSeen(logins: string[]): Promise<Record<string, string | null>> {
  if (!logins.length) return {};
  const { value } = await readActivity();
  return Object.fromEntries(logins.map(login => [login, value.get(login.trim().toLowerCase())?.lastSeen ?? null]));
}
