import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCommunityViewer } from "@/lib/community";
import { isPrideHeaderFlag, normalizeHeaderFlag } from "@/lib/header-flags";
import { parsePixelHeaderArt } from "@/lib/profile-header-art";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

export async function GET(request: NextRequest) {
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const limit = await consumeRateLimit(request, { scope: "player-search", key: viewer.user.id, limit: 60, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много запросов к списку игроков.");

  const query = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (query.length > 24 || (query && !/^[a-z0-9_.-]+$/i.test(query))) {
    return NextResponse.json({ players: [] });
  }
  const database = createSupabaseAdminClient();
  const { data: approvedApplications, error: applicationError } = await database
    .from("waitlist_applications")
    .select("user_id")
    .eq("status", "approved")
    .eq("is_banned", false)
    .eq("is_deleted", false)
    .limit(1_000);
  if (applicationError) return NextResponse.json({ error: "Не удалось загрузить игроков." }, { status: 500 });
  const approvedUserIds = (approvedApplications ?? []).map((application) => application.user_id).filter(Boolean);
  if (!approvedUserIds.length) return NextResponse.json({ players: [] }, { headers: { "Cache-Control": "private, no-store" } });

  let databaseQuery = database
    .from("pc_member_profiles")
    .select("user_id,login,display_name,header_color,header_flag")
    .in("user_id", approvedUserIds)
    .eq("hidden_from_directory", false)
    .order("login")
    .limit(query ? 40 : 300);
  if (query) databaseQuery = databaseQuery.ilike("login", `%${query}%`);
  const [{ data, error }, { data: authUsers, error: authError }] = await Promise.all([
    databaseQuery,
    database.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
  ]);
  if (error) return NextResponse.json({ error: "Не удалось загрузить игроков." }, { status: 500 });
  if (authError) return NextResponse.json({ error: "Не удалось загрузить оформление игроков." }, { status: 500 });
  const hidePrideFlags = Boolean(viewer.user.app_metadata?.hide_pride_flags);
  const authUserMap = new Map(authUsers.users.map((user) => [user.id, user]));
  const players = (data ?? []).map((player) => {
    const headerFlag = normalizeHeaderFlag(authUserMap.get(player.user_id)?.user_metadata?.profile_header_flag ?? player.header_flag);
    return {
      ...player,
      header_flag: hidePrideFlags && isPrideHeaderFlag(headerFlag) ? "none" : headerFlag,
      header_art: parsePixelHeaderArt(authUserMap.get(player.user_id)?.user_metadata?.profile_header_art),
    };
  });
  return NextResponse.json({ players }, { headers: { "Cache-Control": "private, no-store" } });
}
