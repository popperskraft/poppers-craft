import { NextResponse } from "next/server";
import { listLauncherReleases } from "@/lib/launcher-releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ releases: await listLauncherReleases() });
}
