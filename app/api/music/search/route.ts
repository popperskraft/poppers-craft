import { NextRequest, NextResponse } from "next/server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

type ArtistCredit = { name?: string };

export async function GET(request: NextRequest) {
  const clientLimit = await consumeRateLimit(request, { scope: "music-client", limit: 30, windowSeconds: 60 });
  if (!clientLimit.allowed) return rateLimitResponse(clientLimit, "Слишком много запросов к библиотеке.");
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 120) {
    return NextResponse.json({ results: [] });
  }
  const normalizedQuery = query.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
  const globalLimit = await consumeRateLimit(request, { scope: "music-global", key: "global", limit: 45, windowSeconds: 60 });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Музыкальная библиотека занята. Попробуйте позже.");

  const headers = {
    Accept: "application/json",
    "User-Agent": "PoppersCraft/1.0 (https://popperscraft.org)",
  };
  const escapedQuery = normalizedQuery.replace(/["\\]/g, " ");
  const musicQuery = ["recording", "artist", "release"]
    .map((field) => `${field}:"${escapedQuery}"`)
    .join(" OR ");
  const recordingUrl = `https://musicbrainz.org/ws/2/recording/?fmt=json&limit=8&query=${encodeURIComponent(musicQuery)}`;
  try {
    const recordingsResponse = await fetch(recordingUrl, { headers, next: { revalidate: 3600 } });
    if (!recordingsResponse.ok) {
      if (recordingsResponse.status === 429 || recordingsResponse.status === 503) {
        return NextResponse.json(
          { error: "Музыкальная библиотека временно перегружена." },
          { status: 503, headers: { "Retry-After": recordingsResponse.headers.get("retry-after") ?? "60" } },
        );
      }
      throw new Error("Music search failed");
    }
    const recordings = await recordingsResponse.json();
    type Recording = { id: string; title: string; "artist-credit"?: ArtistCredit[]; releases?: Array<{ id: string; title: string; "release-group"?: { id?: string } }> };
    const songs = (recordings.recordings ?? []).map((item: Recording) => ({
      id: item.id,
      title: item.title,
      artist: item["artist-credit"]?.map((artist) => artist.name).filter(Boolean).join(", ") || "Неизвестный исполнитель",
      type: "ПЕСНЯ" as const,
    }));
    const seenAlbums = new Set<string>();
    const albums = (recordings.recordings ?? []).flatMap((item: Recording) => (item.releases ?? []).slice(0, 1).map((release) => ({
      id: release["release-group"]?.id ?? release.id,
      title: release.title,
      artist: item["artist-credit"]?.map((artist) => artist.name).filter(Boolean).join(", ") || "Неизвестный исполнитель",
      type: "АЛЬБОМ" as const,
    }))).filter((album: { id: string }) => {
      if (seenAlbums.has(album.id)) return false;
      seenAlbums.add(album.id);
      return true;
    }).slice(0, 6);
    return NextResponse.json({ results: [...songs, ...albums] }, { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" } });
  } catch {
    return NextResponse.json({ error: "Музыкальная библиотека временно недоступна." }, { status: 502 });
  }
}
