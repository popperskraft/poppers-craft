import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createPlayerSkinSignedUrl,
  getPlayerSkinModel,
  getPlayerSkinPath,
  getPlayerSkinUpdatedAt,
  MAX_PLAYER_SKIN_BYTES,
  savePlayerSkin,
  validatePlayerSkin,
  type PlayerSkinModel,
} from "@/lib/player-skins";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidLogin, normalizeLogin } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.POPPERSCRAFT_BROWSER_SECRET ?? "";
  const supplied = request.headers.get("x-popperscraft-browser-key") ?? "";
  if (!safeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const login = normalizeLogin(String(body?.login ?? ""));
  if (!isValidLogin(login)) {
    return NextResponse.json({ error: "Invalid login" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: applications, error: applicationError } = await admin
    .from("waitlist_applications")
    .select("user_id,login")
    .eq("login", login)
    .eq("status", "approved")
    .eq("is_banned", false)
    .eq("is_deleted", false)
    .limit(1);
  const application = applications?.[0];
  if (applicationError) {
    return NextResponse.json({ error: "Skin lookup failed" }, { status: 503 });
  }
  if (!application?.user_id) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(application.user_id);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Player profile lookup failed" }, { status: 503 });
  }

  let metadata = authData.user.user_metadata as Record<string, unknown>;
  const encoded = body?.skinBase64;
  if (encoded !== undefined) {
    const model = body?.model as PlayerSkinModel;
    if (
      typeof encoded !== "string"
      || encoded.length > Math.ceil(MAX_PLAYER_SKIN_BYTES * 4 / 3) + 4
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
      || (model !== "classic" && model !== "slim")
    ) {
      return NextResponse.json({ error: "Invalid skin upload" }, { status: 400 });
    }
    const bytes = Buffer.from(encoded, "base64");
    try {
      validatePlayerSkin(bytes);
      const saved = await savePlayerSkin({
        userId: application.user_id,
        currentMetadata: metadata,
        bytes,
        model,
      });
      metadata = saved.metadata;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid skin upload" },
        { status: 400 },
      );
    }
  }

  const url = await createPlayerSkinSignedUrl(application.user_id, metadata);
  if (!url && getPlayerSkinPath(application.user_id, metadata)) {
    return NextResponse.json({error:"Skin signing temporarily unavailable"},{status:503,headers:{"Cache-Control":"private, no-store"}});
  }
  const skin = url ? {
    url,
    model: getPlayerSkinModel(metadata),
    updatedAt: getPlayerSkinUpdatedAt(metadata, authData.user.updated_at ?? "0"),
  } : null;
  return NextResponse.json(
    { approved: true, userId: application.user_id, login: application.login, skin, skinLookupComplete: true },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

function safeEqual(expected: string, supplied: string) {
  if (expected.length < 32 || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
