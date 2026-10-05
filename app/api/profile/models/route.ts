import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { canUseCosmetic } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

async function proxy(request: Request, mutate: boolean) {
  if (mutate && !sameOriginOrMissing(request))
    return Response.json({ error: "Недопустимый запрос." }, { status: 403, headers: NO_STORE });
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa)
    return Response.json({ error: "Войдите в аккаунт PoppersCraft.", loginRequired: true }, { status: 401, headers: NO_STORE });
  const viewer = await getCommunityViewer({ identity });
  if (!viewer)
    return Response.json({ error: "Редактор доступен участникам с одобренной заявкой." }, { status: 403, headers: NO_STORE });
  const key = process.env.POPPERSCRAFT_BROWSER_SECRET ?? "";
  if (key.length < 32)
    return Response.json({ error: "Сохранение моделей пока недоступно." }, { status: 503, headers: NO_STORE });
  let data: Record<string, unknown> = {};
  if (mutate) {
    const limit = await consumeRateLimit(request, { scope: "character-model", key: viewer.user.id, limit: 60, windowSeconds: 3600 });
    if (!limit.allowed) return rateLimitResponse(limit, "Слишком много сохранений. Попробуйте позже.");
    // Bound the actual stream; Content-Length is optional and not trustworthy.
    const reader = request.body?.getReader();
    let raw = "", size = 0;
    const decoder = new TextDecoder();
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32 * 1024) { await reader.cancel(); return Response.json({ error: "Скин слишком большой." }, { status: 413 }); }
        raw += decoder.decode(value, { stream: true });
      }
    }
    try {
      const body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      data = { mode: body.mode, revision: body.revision };
      if (body.action === "wardrobe") data = { action: "wardrobe", operation: body.operation, kind: body.kind, slotId: body.slotId, revision: body.revision, model: body.model };
      if (body.action !== undefined && body.action !== "wardrobe") throw new Error();
      if (body.pixelsBase64 !== undefined) Object.assign(data, { pixelsBase64: body.pixelsBase64, race: body.race, size: body.size, tailLength: body.tailLength, snout: body.snout });
    } catch { return Response.json({ error: "Не удалось прочитать настройки." }, { status: 400 }); }
    /* Пони — возможность HYPE, если владелец включил ограничение косметики. */
    if ((data.mode === "pony" || (data.kind === "pony" && data.operation !== "delete") || (data.action !== "wardrobe" && data.pixelsBase64 !== undefined)) && !(await canUseCosmetic(viewer.user.id, "pony")))
      return Response.json({ error: "Скин пони входит в тариф POPPERS HYPE. Оформить его можно на странице доната.", plusRequired: true }, { status: 403, headers: NO_STORE });
  }
  if (!mutate) {
    const query = new URL(request.url).searchParams;
    if (query.has("slotId")) data = { action: "slot", kind: query.get("kind"), slotId: query.get("slotId") };
  }
  try {
    const response = await fetch("https://api.popperscraft.org/api/models/profile", {
      method: "POST", headers: { "Content-Type": "application/json", "X-PoppersCraft-Browser-Key": key },
      body: JSON.stringify({ ...data, login: viewer.profile.login.toLowerCase() }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    return Response.json(payload, { status: response.status, headers: NO_STORE });
  } catch {
    return Response.json({ error: "Не удалось связаться с сервером моделей. Рисунок остаётся в редакторе." }, { status: 503, headers: NO_STORE });
  }
}
async function handle(request:Request,mutate:boolean){
  try{return await proxy(request,mutate);}catch{
    return Response.json({error:"Сохранение сейчас недоступно. Вы можете рисовать и скачать готовый PNG."},{status:503,headers:NO_STORE});
  }
}
export function GET(request: Request) { return handle(request, false); }
export function POST(request: Request) { return handle(request, true); }
