import { NextResponse } from "next/server";
import {
  encodeSiteBoard,
  getAdminUser,
  listSiteUpdates,
  sameOriginOrMissing,
} from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supportedMinecraftIcons } from "@/lib/minecraft-icons";
import { isUpdateColor, isUpdateFlag } from "@/lib/update-styles";

export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  return NextResponse.json({ updates: await listSiteUpdates() });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (body?.kind === "board") {
    const status = String(body.status);
    const placement = String(body.placement);
    const title = String(body.title ?? "Новый блок").trim().slice(0, 120);
    const windowTitle = String(body.windowTitle ?? "popperscraft_block.paint").trim().slice(0, 80);
    const template = String(body.template ?? "paint");
    const surface = String(body.surface ?? "paper");
    const audience = String(body.audience ?? "everyone");
    const submitLabel = String(body.submitLabel ?? "ОТПРАВИТЬ").trim().slice(0, 40);
    const publishAt = body.publishAt ? String(body.publishAt) : null;
    const allowedTypes = ["heading", "text", "callout", "field"];
    const allowedBackgrounds = ["paper", "grass", "stone", "night", "pink", "cyan"];
    const allowedHighlights = ["none", "lime", "yellow", "pink", "cyan"];
    const allowedIcons = supportedMinecraftIcons;
    const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 10).map((block: Record<string, unknown>) => ({ id: String(block.id ?? crypto.randomUUID()).slice(0, 20), type: String(block.type), text: String(block.text ?? "").trim().slice(0, 240), emoji: String(block.emoji), background: String(block.background), highlight: String(block.highlight), ...(String(block.type) === "field" ? { fieldType: ["short", "long", "choice"].includes(String(block.fieldType)) ? String(block.fieldType) : "short", required: block.required === true, options: Array.isArray(block.options) ? block.options.map(String).map((item) => item.trim().slice(0, 40)).filter(Boolean).slice(0, 5) : [] } : {}) })) : [];
    const placements = ["updates", "after-hero", "after-overview", "after-waitlist", "after-donate", "before-discord"];
    const valid = title.length >= 3 && ["paint", "form", "announcement", "cards"].includes(template) && allowedBackgrounds.includes(surface) && ["everyone", "guests", "members", "admins"].includes(audience) && ["draft", "published", "scheduled"].includes(status) && placements.includes(placement) && blocks.length > 0 && blocks.every((block: { type: string; text: string; emoji: string; background: string; highlight: string; fieldType?: string; options?: string[] }) => allowedTypes.includes(block.type) && block.text.length > 0 && allowedIcons.includes(block.emoji) && allowedBackgrounds.includes(block.background) && allowedHighlights.includes(block.highlight) && (block.type !== "field" || block.fieldType !== "choice" || Boolean(block.options?.length))) && (status !== "scheduled" || (publishAt && Number.isFinite(Date.parse(publishAt)) && Date.parse(publishAt) > Date.now()));
    if (!valid) return NextResponse.json({ error: "Проверьте блоки, место и время публикации." }, { status: 400 });
    const board = { kind: "board", title, windowTitle, template, surface, audience, submitLabel, placement, status, publishAt: status === "scheduled" ? publishAt : null, blocks };
    const serialized = encodeSiteBoard(board as Parameters<typeof encodeSiteBoard>[0]);
    if (serialized.length > 1200) return NextResponse.json({ error: "Блок получился слишком большим. Сократите текст или количество полей." }, { status: 400 });
    const { data, error } = await createSupabaseAdminClient().from("site_updates").insert({ source_key: `board:${crypto.randomUUID()}`, badge: "BLOCK", title, body: serialized, color: "cyan", published: status === "published", author_admin_id: admin.profile.id }).select("id,badge,title,body,color,published,created_at").single();
    if (error) return NextResponse.json({ error: "Не удалось сохранить блок." }, { status: 500 });
    return NextResponse.json({ update: { ...data, author_name: admin.profile.display_name, board } });
  }
  const badge = String(body?.badge ?? "").trim().toUpperCase();
  const title = String(body?.title ?? "").trim();
  const updateBody = String(body?.body ?? "").trim();
  const color = String(body?.color ?? "lime");
  if (
    badge.length < 2 ||
    badge.length > 16 ||
    title.length < 3 ||
    title.length > 120 ||
    updateBody.length < 3 ||
    updateBody.length > 1200 ||
    !isUpdateColor(color)
  ) {
    return NextResponse.json(
      { error: "Проверьте заголовок, метку и текст обновления." },
      { status: 400 },
    );
  }

  const flagStyle = isUpdateFlag(color) ? color : null;
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .insert({
      source_key: flagStyle ? `style:${flagStyle}:${crypto.randomUUID()}` : null,
      badge,
      title,
      body: updateBody,
      color: flagStyle ? "pink" : color,
      published: true,
      author_admin_id: admin.profile.id,
    })
    .select("id,badge,title,body,color,published,created_at")
    .single();
  if (error) {
    return NextResponse.json(
      { error: "Не удалось опубликовать обновление." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    update: { ...data, color, author_name: admin.profile.display_name },
  });
}

export async function DELETE(request: Request) {
  const admin = await getAdminUser();
  if (!admin || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Некорректная запись." }, { status: 400 });
  }

  const database = createSupabaseAdminClient();
  await database.from("site_updates").delete().like("source_key", `__board_response:${id}:%`);
  const { data, error } = await database
    .from("site_updates")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: "Не удалось удалить обновление." },
      { status: error ? 500 : 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
