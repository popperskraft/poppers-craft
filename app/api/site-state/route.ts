import { NextResponse } from "next/server";
import { getSiteSettings, getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export async function GET() {
  const [settings, viewer] = await Promise.all([
    getSiteSettings(),
    getViewerIdentity(),
  ]);
  const isOwner = viewer?.adminProfile?.role === "owner";
  /* Администраторы видят сайт во время отсчёта до открытия как обычно. */
  const isAdmin = Boolean(viewer?.adminProfile?.active) && !viewer?.needsMfa;

  return NextResponse.json(
    {
      crashMode: settings.crashMode && !isOwner,
      ratingPromptId: settings.ratingPromptId,
      openingAt: isAdmin ? null : settings.openingAt,
      serverNow: Date.now(),
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
