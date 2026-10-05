import type { User } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { skinPreviewUrl } from "@/lib/skin-preview";
import { createPlayerSkinSignedUrls } from "@/lib/player-skins";
import { readUpdateColor, type UpdateColor } from "@/lib/update-styles";

export type { UpdateColor } from "@/lib/update-styles";

export type ApplicationStatus = "pending" | "approved" | "rejected";
export type AdminRole = "owner" | "admin";
export type AdminVote = "approve" | "reject";
export type ModerationAction = "ban" | "delete";

/* Личные почты владельцев — в .env сервера, а не в коде (r106):
   PC_OWNER_EMAIL — владелец, PC_CREATOR_EMAIL — создатель проекта. */
const envEmail = (value: string | undefined) => value?.trim().toLowerCase() || null;
export const PROTECTED_OWNER_EMAIL = envEmail(process.env.PC_OWNER_EMAIL);
export const PROJECT_CREATOR_EMAIL = envEmail(process.env.PC_CREATOR_EMAIL);
export const PROTECTED_OWNER_EMAILS = new Set(
  [PROTECTED_OWNER_EMAIL, "popperskraft@gmail.com", PROJECT_CREATOR_EMAIL].filter((email): email is string => Boolean(email)),
);
export const PROTECTED_ADMIN_EMAILS = PROTECTED_OWNER_EMAILS;

const PROTECTED_OWNER_NAMES = new Map<string, string>([
  ...(PROTECTED_OWNER_EMAIL ? [[PROTECTED_OWNER_EMAIL, "Владелец"] as [string, string]] : []),
  ["popperskraft@gmail.com", "PoppersCraft"],
  ...(PROJECT_CREATOR_EMAIL ? [[PROJECT_CREATOR_EMAIL, "Платон"] as [string, string]] : []),
]);

export type ApplicationRow = {
  id: number;
  user_id: string | null;
  login: string;
  who: string;
  from_where: string;
  why_server: string;
  why_you: string;
  favorite_music: string;
  social_links: string;
  skin_url: string | null;
  status: ApplicationStatus;
  created_at: string;
  reviewed_at: string | null;
  is_banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  approvals: number;
  rejections: number;
  my_vote: AdminVote | null;
  player_approvals: number;
  player_rejections: number;
  is_protected: boolean;
  /* Скрыт администратором из общего списка игроков. */
  hidden_from_directory: boolean;
};

export type PlayerReview = {
  userId: string;
  author: string;
  rating: number;
  comment: string;
  createdAt: string;
  likes: number;
  dislikes: number;
  myReaction: "like" | "dislike" | null;
  replies: PlayerReviewReply[];
  myReply: PlayerReviewReply | null;
};

export type PlayerReviewReply = {
  userId: string;
  author: string;
  comment: string;
  createdAt: string;
};

/* Заявка в голосовании игроков: только то, что показывается на странице.
   Служебное (id аккаунта, бан и его причина, голоса администраторов)
   игрокам не отдаётся. */
export type PlayerApplicationRow = Pick<ApplicationRow,
  "id" | "login" | "who" | "from_where" | "why_server" | "why_you" | "favorite_music" | "social_links" | "skin_url" | "created_at" | "player_approvals" | "player_rejections"
> & {
  my_player_vote: "approve" | "reject" | null;
  reviews: PlayerReview[];
  my_review: PlayerReview | null;
  average_rating: number;
};

export type AdminProfile = {
  id: number;
  user_id: string | null;
  email: string;
  display_name: string;
  role: AdminRole;
  active: boolean;
  created_at: string;
  is_protected?: boolean;
};

export type AdminIdentity = {
  user: User;
  profile: AdminProfile;
};

export type ViewerIdentity = {
  user: User;
  adminProfile: AdminProfile | null;
  needsMfa: boolean;
};

export type SiteUpdateRow = {
  id: number;
  badge: string;
  title: string;
  body: string;
  color: UpdateColor;
  published: boolean;
  created_at: string;
  author_name: string;
  board?: SiteBoardData;
};

export type SiteBoardBlock = {
  id: string;
  type: "heading" | "text" | "callout" | "field";
  text: string;
  emoji: string;
  background: "paper" | "grass" | "stone" | "night" | "pink" | "cyan";
  highlight: "none" | "lime" | "yellow" | "pink" | "cyan";
  fieldType?: "short" | "long" | "choice";
  required?: boolean;
  options?: string[];
};

export type SiteBoardData = {
  kind: "board";
  title?: string;
  windowTitle?: string;
  template?: "paint" | "form" | "announcement" | "cards";
  surface?: "paper" | "grass" | "stone" | "night" | "pink" | "cyan";
  audience?: "everyone" | "guests" | "members" | "admins";
  submitLabel?: string;
  placement: "updates" | "after-hero" | "after-overview" | "after-waitlist" | "after-donate" | "before-discord";
  status: "draft" | "published" | "scheduled";
  publishAt: string | null;
  blocks: SiteBoardBlock[];
};

export function encodeSiteBoard(board: SiteBoardData) {
  return `z:${deflateRawSync(Buffer.from(JSON.stringify(board))).toString("base64url")}`;
}

export function decodeSiteBoard(value: string): SiteBoardData {
  const json = value.startsWith("z:")
    ? inflateRawSync(Buffer.from(value.slice(2), "base64url")).toString()
    : value;
  return JSON.parse(json) as SiteBoardData;
}

export type SiteSettings = {
  maintenanceMode: boolean;
  crashMode: boolean;
  ratingPromptId: string | null;
  endsAt: string | null;
  updatedAt: string | null;
  /* Время торжественного открытия платформы. Пока оно в будущем, всем,
     кроме администраторов, показывается окно с обратным отсчётом. */
  openingAt: string | null;
};

export type DonationInterestRow = {
  id: number;
  email: string;
  account: string;
  status: "member" | "account" | "guest";
  created_at: string;
};

export type BugReportRow = {
  id: number;
  user_id: string | null;
  reporter_email: string | null;
  description: string;
  page_url: string;
  user_agent: string;
  log_ids: number[];
  status: "new" | "in_progress" | "resolved";
  created_at: string;
  updated_at: string;
};

export type CommunicationRatingRow = {
  id: number;
  stars: number;
  feedback: string;
  page_url: string;
  email: string | null;
  created_at: string;
};

export type CommunicationNotificationRow = {
  id: string;
  kind: "support" | "system" | "telegram" | "admin";
  title: string;
  body: string;
  status: string;
  created_at: string;
};

export type CommunicationMetrics = {
  registered_accounts: number;
  active_last_30_days: number;
  approved_players: number;
  pending_applications: number;
  feed_posts: number;
  feed_comments: number;
  unresolved_bugs: number;
  rating_count: number;
  average_rating: number;
};

export type CommunicationOverview = {
  metrics: CommunicationMetrics;
  ratings: CommunicationRatingRow[];
  notifications: CommunicationNotificationRow[];
  bug_reports: BugReportRow[];
  donation_interests: DonationInterestRow[];
};

export type ModerationProposalRow = {
  id: number;
  application_id: number;
  action: ModerationAction;
  reason: string;
  status: "pending" | "executed" | "rejected";
  created_by: number;
  created_at: string;
  resolved_at: string | null;
  approvals: number;
  rejections: number;
  my_vote: AdminVote | null;
};

export function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

export function isProtectedOwnerEmail(email: string | null | undefined) {
  return PROTECTED_OWNER_EMAILS.has(email?.trim().toLowerCase() ?? "");
}

export function isProtectedAdminEmail(email: string | null | undefined) {
  return PROTECTED_ADMIN_EMAILS.has(email?.trim().toLowerCase() ?? "");
}

export async function isProtectedOwnerUserId(userId: string | null | undefined) {
  if (!userId) return false;
  const admin = createSupabaseAdminClient();
  const [{ data: profile, error: profileError }, { data, error }] = await Promise.all([
    admin
      .from("admin_profiles")
      .select("role,active")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (profileError) throw profileError;
  if (error) throw error;
  return Boolean(profile?.active && profile.role === "owner") || isProtectedOwnerEmail(data.user?.email);
}

export function isValidLogin(value: string) {
  return /^[a-z0-9_.-]{3,24}$/.test(value);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  const normalized = normalizeEmail(value);
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function loginToEmail(login: string) {
  return `${normalizeLogin(login)}@users.popperscraft.org`;
}

export function loginIdentifierToEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("@") ? normalized : loginToEmail(normalized);
}

export async function resolveLoginIdentifierToEmail(value: string) {
  const normalized = normalizeLogin(value);
  if (normalized.includes("@") || !isValidLogin(normalized)) {
    return loginIdentifierToEmail(normalized);
  }

  const admin = createSupabaseAdminClient();
  const { data: application } = await admin
    .from("waitlist_applications")
    .select("user_id")
    .eq("login", normalized)
    .maybeSingle();

  if (application?.user_id) {
    const { data } = await admin.auth.admin.getUserById(application.user_id);
    const accountEmail = data.user?.email;
    if (accountEmail) return normalizeEmail(accountEmail);
  }

  return loginToEmail(normalized);
}

export function sameOriginOrMissing(request: Request) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) return true;

  let origin: string;
  let requestOrigin: string;
  try {
    origin = new URL(rawOrigin).origin;
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  if (origin === requestOrigin) return true;

  // On Play2Go Next.js receives an internal HTTP URL from Caddy, while the
  // browser correctly sends the public HTTPS origin. Keep the CSRF check
  // strict, but recognise the two canonical public origins of this project.
  const allowedPublicOrigins = new Set([
    "https://popperscraft.org",
    "https://www.popperscraft.org",
  ]);
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (configuredSiteUrl) {
    try {
      allowedPublicOrigins.add(new URL(configuredSiteUrl).origin);
    } catch {
      // A malformed optional URL must not make the origin check permissive.
    }
  }

  return allowedPublicOrigins.has(origin);
}

export function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAllowedAdminEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (isProtectedOwnerEmail(normalized)) return true;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("admin_profiles")
    .select("id,user_id")
    .eq("email", normalized)
    .eq("active", true)
    .maybeSingle();

  if (!error && data) return true;
  if (!error) {
    const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
    if (!usersError) {
      const authUser = users.users.find((user) => user.email?.trim().toLowerCase() === normalized);
      if (authUser) {
        const { data: linkedProfile, error: linkedError } = await admin
          .from("admin_profiles")
          .select("id")
          .eq("user_id", authUser.id)
          .eq("active", true)
          .maybeSingle();
        if (!linkedError) return Boolean(linkedProfile);
      }
    }
  }
  return getAdminEmails().includes(normalized);
}

async function findAdminProfileForUser(
  user: User,
): Promise<AdminProfile | null> {
  const email = user?.email?.toLowerCase();
  if (!email) return null;

  const admin = createSupabaseAdminClient();
  const { data: linkedProfile, error: linkedProfileError } = await admin
    .from("admin_profiles")
    .select("id,user_id,email,display_name,role,active,created_at")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (linkedProfileError) return null;
  if (linkedProfile) {
    let currentProfile = linkedProfile as AdminProfile;
    if (linkedProfile.email !== email) {
      const { data: synchronized } = await admin
        .from("admin_profiles")
        .update({ email })
        .eq("id", linkedProfile.id)
        .eq("user_id", user.id)
        .select("id,user_id,email,display_name,role,active,created_at")
        .maybeSingle();
      if (synchronized) currentProfile = synchronized as AdminProfile;
    }
    return {
      ...currentProfile,
      is_protected: currentProfile.role === "owner" || isProtectedAdminEmail(currentProfile.email),
    };
  }

  if (isProtectedOwnerEmail(email)) {
    const { data: protectedProfile, error: protectedError } = await admin
      .from("admin_profiles")
      .select("id,user_id,email,display_name,role,active,created_at")
      .eq("email", email)
      .maybeSingle();
    if (protectedError) return null;
    /* Права по одной почте не выдаются: анкета создаёт аккаунт с любой
       почтой без проверки ящика, и кто угодно занял бы свободную почту
       владельца. Профиль должен быть уже привязан к этому аккаунту (r104). */
    if (!protectedProfile?.user_id || protectedProfile.user_id !== user.id) return null;

    const { data: repaired, error: repairError } = await admin
      .from("admin_profiles")
      .upsert(
        {
          ...(protectedProfile?.id ? { id: protectedProfile.id } : {}),
          user_id: user.id,
          email,
          display_name: protectedProfile?.display_name ?? PROTECTED_OWNER_NAMES.get(email) ?? "Владелец",
          role: "owner",
          active: true,
        },
        { onConflict: "email" },
      )
      .select("id,user_id,email,display_name,role,active,created_at")
      .single();
    if (repairError || !repaired) return null;
    return { ...(repaired as AdminProfile), is_protected: true };
  }

  const { data, error } = await admin
    .from("admin_profiles")
    .select("id,user_id,email,display_name,role,active,created_at")
    .eq("email", email)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;
  /* Непривязанный профиль по совпадению почты не привязывается — по той же
     причине, что и выше. Админка всегда сохраняет профиль сразу с user_id. */
  if (!data.user_id || data.user_id !== user.id) return null;

  return data as AdminProfile;
}

export async function getViewerIdentity(): Promise<ViewerIdentity | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    user,
    adminProfile: await findAdminProfileForUser(user),
    needsMfa: assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2",
  };
}

export async function getAdminUser(): Promise<AdminIdentity | null> {
  const viewer = await getViewerIdentity();
  if (!viewer?.adminProfile || viewer.needsMfa) return null;

  return {
    user: viewer.user,
    profile: viewer.adminProfile,
  };
}

const OPENING_KEY = "__opening_countdown__";

/* Отсчёт действует, только пока время открытия впереди: после него сайт
   открывается сам, без отдельного выключения. */
function parseOpeningAt(body: string | null | undefined) {
  if (!body) return null;
  try {
    const stored = JSON.parse(body) as { opensAt?: string | null };
    const opensAt = typeof stored.opensAt === "string" ? Date.parse(stored.opensAt) : NaN;
    return Number.isFinite(opensAt) && opensAt > Date.now() ? new Date(opensAt).toISOString() : null;
  } catch {
    return null;
  }
}

function parseStoredFlag(body: string | null | undefined) {
  if (body === "enabled") return true;
  if (!body) return false;
  try {
    return Boolean((JSON.parse(body) as { enabled?: boolean }).enabled);
  } catch {
    return false;
  }
}

function parseRatingPromptId(body: string | null | undefined) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { id?: unknown; enabled?: unknown };
    const id = typeof parsed.id === "string" ? parsed.id.trim().slice(0, 100) : "";
    return parsed.enabled !== false && id ? id : null;
  } catch {
    return null;
  }
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const admin = createSupabaseAdminClient();
  const forceOffMarker = "__maintenance_force_off_20260802__";
  const { data: rows, error: settingsError } = await admin
    .from("site_updates")
    .select("source_key,body,updated_at")
    .in("source_key", [forceOffMarker, "__maintenance_mode__", "__crash_mode__", "__rating_prompt__", OPENING_KEY]);

  if (settingsError) {
    return { maintenanceMode: false, crashMode: false, ratingPromptId: null, endsAt: null, updatedAt: null, openingAt: null };
  }
  const openingAt = parseOpeningAt(rows?.find((row) => row.source_key === OPENING_KEY)?.body);

  const forceOff = rows?.find((row) => row.source_key === forceOffMarker);
  const crashRow = rows?.find((row) => row.source_key === "__crash_mode__");
  const ratingRow = rows?.find((row) => row.source_key === "__rating_prompt__");
  const crashMode = parseStoredFlag(crashRow?.body);
  const ratingPromptId = parseRatingPromptId(ratingRow?.body);

  if (!forceOff) {
    const now = new Date().toISOString();
    await Promise.all([
      admin.from("site_updates").upsert({
        source_key: "__maintenance_mode__",
        badge: "SYSTEM",
        title: "Maintenance Mode",
        body: JSON.stringify({ enabled: false, endsAt: null }),
        color: "yellow",
        published: false,
        updated_at: now,
      }, { onConflict: "source_key" }),
      admin.from("site_updates").upsert({
        source_key: forceOffMarker,
        badge: "SYSTEM",
        title: "Maintenance force-off applied",
        body: "completed",
        color: "yellow",
        published: false,
        updated_at: now,
      }, { onConflict: "source_key" }),
    ]);
    return { maintenanceMode: false, crashMode, ratingPromptId, endsAt: null, updatedAt: now, openingAt };
  }

  const data = rows?.find((row) => row.source_key === "__maintenance_mode__");

  if (!data) {
    return { maintenanceMode: false, crashMode, ratingPromptId, endsAt: null, updatedAt: null, openingAt };
  }
  let maintenanceMode = data.body === "enabled";
  let endsAt: string | null = null;
  try {
    const stored = JSON.parse(data.body) as { enabled?: boolean; endsAt?: string | null };
    maintenanceMode = Boolean(stored.enabled);
    endsAt = stored.endsAt ?? null;
  } catch {
    // Keep compatibility with the previous enabled/disabled setting.
  }
  if (maintenanceMode && endsAt && new Date(endsAt).getTime() <= Date.now()) {
    maintenanceMode = false;
    endsAt = null;
  }
  return {
    maintenanceMode,
    crashMode,
    ratingPromptId,
    endsAt,
    updatedAt: data.updated_at ?? null,
    openingAt,
  };
}

/* Запуск (opensAt) или остановка (null) обратного отсчёта до открытия. */
export async function setOpeningCountdown(opensAt: string | null, adminId: number): Promise<SiteSettings> {
  const now = new Date().toISOString();
  const { error } = await createSupabaseAdminClient()
    .from("site_updates")
    .upsert({
      source_key: OPENING_KEY,
      badge: "SYSTEM",
      title: "Opening Countdown",
      body: JSON.stringify({ opensAt, startedAt: opensAt ? now : null, adminId }),
      color: "yellow",
      published: false,
      author_admin_id: adminId,
      updated_at: now,
    }, { onConflict: "source_key" });
  if (error) throw error;
  return getSiteSettings();
}

export async function setMaintenanceMode(
  maintenanceMode: boolean,
  adminId: number,
  endsAt: string | null = null,
): Promise<SiteSettings> {
  const body = JSON.stringify({
    enabled: maintenanceMode,
    endsAt: maintenanceMode ? endsAt : null,
  });
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .upsert({
      source_key: "__maintenance_mode__",
      badge: "SYSTEM",
      title: "Maintenance Mode",
      body,
      color: "yellow",
      published: false,
      author_admin_id: adminId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" })
    .select("body,updated_at")
    .single();
  if (error) throw error;
  const current = await getSiteSettings();
  return {
    ...current,
    maintenanceMode,
    endsAt: maintenanceMode ? endsAt : null,
    updatedAt: data.updated_at ?? current.updatedAt,
  };
}

export async function setCrashMode(
  crashMode: boolean,
  adminId: number,
): Promise<SiteSettings> {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .upsert({
      source_key: "__crash_mode__",
      badge: "SYSTEM",
      title: "Crash Mode",
      body: JSON.stringify({ enabled: crashMode }),
      color: "yellow",
      published: false,
      author_admin_id: adminId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" })
    .select("updated_at")
    .single();

  if (error) throw error;

  const settings = await getSiteSettings();
  return {
    ...settings,
    crashMode,
    updatedAt: data.updated_at ?? settings.updatedAt,
  };
}

export async function triggerSiteRatingPrompt(adminId: number): Promise<SiteSettings> {
  const promptId = `${Date.now()}-${randomUUID()}`;
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .upsert({
      source_key: "__rating_prompt__",
      badge: "RATING",
      title: "Site rating prompt",
      body: JSON.stringify({ id: promptId, enabled: true }),
      color: "yellow",
      published: false,
      author_admin_id: adminId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" })
    .select("updated_at")
    .single();
  if (error) throw error;
  const settings = await getSiteSettings();
  return { ...settings, ratingPromptId: promptId, updatedAt: data.updated_at ?? settings.updatedAt };
}

export async function listApplications(adminId?: number) {
  const admin = createSupabaseAdminClient();
  const [{ data, error }, { data: votes, error: votesError }, { data: playerVotes }, { data: authUsers }, { data: hiddenProfiles }] = await Promise.all([
    admin
      .from("waitlist_applications")
      .select(
        "id,user_id,login,who,from_where,why_server,why_you,status,created_at,reviewed_at,is_banned,ban_reason,banned_at,is_deleted,deleted_at",
      )
      .order("is_deleted")
      .order("status")
      .order("created_at", { ascending: false }),
    admin
      .from("application_votes")
      .select("application_id,admin_id,vote"),
    admin
      .from("site_updates")
      .select("title,body")
      .like("title", "application:%")
      .eq("published", false),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("pc_member_profiles").select("user_id").eq("hidden_from_directory", true).limit(1000),
  ]);

  if (error) throw error;
  if (votesError) throw votesError;
  const hiddenIds = new Set((hiddenProfiles ?? []).map((row) => String(row.user_id)));

  const skinUrls = await createPlayerSkinSignedUrls(
    (authUsers?.users ?? []).map((user) => ({
      userId: user.id,
      metadata: user.user_metadata,
    })),
  );

  const applications = (data ?? []).map((application) => {
    const applicationVotes = (votes ?? []).filter(
      (vote) => vote.application_id === application.id,
    );
    const memberVotes = (playerVotes ?? []).filter(
      (vote) => vote.title === `application:${application.id}`,
    );
    const authUser = authUsers?.users.find((user) => user.id === application.user_id);
    return {
      ...application,
      favorite_music: String(authUser?.user_metadata?.favorite_music ?? ""),
      social_links: String(authUser?.user_metadata?.social_links ?? ""),
      skin_url: application.status === "approved" ? skinPreviewUrl(application.login) : application.user_id ? skinUrls.get(application.user_id) ?? null : null,
      approvals: applicationVotes.filter((vote) => vote.vote === "approve").length,
      rejections: applicationVotes.filter((vote) => vote.vote === "reject").length,
      my_vote:
        (applicationVotes.find((vote) => vote.admin_id === adminId)?.vote as
          | AdminVote
          | undefined) ?? null,
      player_approvals: memberVotes.filter((vote) => vote.body === "approve").length,
      player_rejections: memberVotes.filter((vote) => vote.body === "reject").length,
      is_protected: isProtectedOwnerEmail(authUser?.email),
      hidden_from_directory: Boolean(application.user_id && hiddenIds.has(application.user_id)),
    } as ApplicationRow;
  });

  const queuePriority = (application: ApplicationRow) => {
    if (application.is_deleted) return 3;
    if (application.status === "pending") return 0;
    if (application.status === "approved") return 1;
    return 2;
  };

  return applications.sort((left, right) =>
    queuePriority(left) - queuePriority(right)
    || Date.parse(right.created_at) - Date.parse(left.created_at),
  );
}

export async function listAdmins() {
  const { data, error } = await createSupabaseAdminClient()
    .from("admin_profiles")
    .select("id,user_id,email,display_name,role,active,created_at")
    .eq("active", true)
    .order("role", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((profile) => ({
    ...profile,
    role: isProtectedOwnerEmail(profile.email) ? "owner" : profile.role,
    is_protected: profile.role === "owner" || isProtectedAdminEmail(profile.email),
  })) as AdminProfile[];
}

export async function listSiteUpdates(publishedOnly = false) {
  const admin = createSupabaseAdminClient();
  const query = admin
    .from("site_updates")
    .select("id,source_key,badge,title,body,color,published,created_at,author_admin_id")
    .or("source_key.is.null,source_key.not.like.\\_\\_%")
    .order("created_at", { ascending: false })
    .limit(100);
  const [{ data, error }, { data: admins }] = await Promise.all([
    query,
    admin.from("admin_profiles").select("id,display_name"),
  ]);
  if (error) throw error;

  const names = new Map(
    (admins ?? []).map((profile) => [profile.id, profile.display_name]),
  );
  const now = Date.now();
  return (data ?? []).flatMap((update) => {
    if (update.source_key?.startsWith("__")) return [];
    let board: SiteBoardData | undefined;
    if (update.source_key?.startsWith("board:")) {
      try {
        const parsed = decodeSiteBoard(update.body);
        if (parsed.kind === "board" && Array.isArray(parsed.blocks)) board = parsed;
      } catch {
        board = undefined;
      }
    }
    const boardIsLive = board?.status === "published" || (
      board?.status === "scheduled" &&
      Boolean(board.publishAt) &&
      Date.parse(String(board.publishAt)) <= now
    );
    if (publishedOnly && !(update.published || boardIsLive)) return [];
    return [{
    id: update.id,
    badge: update.badge,
    title: update.title,
    body: update.body,
    color: readUpdateColor(update.source_key, update.color),
    published: update.published,
    created_at: update.created_at,
    author_name: names.get(update.author_admin_id) ?? "PoppersCraft",
    ...(board ? { board } : {}),
    }];
  }).slice(0, 20) as SiteUpdateRow[];
}

export async function listDonationInterests() {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,title,body,created_at,updated_at")
    .like("source_key", "__donation_interest:%")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  return (data ?? []).map((row) => {
    let details: { account?: string; status?: DonationInterestRow["status"] } = {};
    try {
      details = JSON.parse(row.body) as typeof details;
    } catch {
      details = {};
    }
    return {
      id: row.id,
      email: row.title,
      account: details.account ?? "—",
      status: details.status ?? "guest",
      created_at: row.updated_at ?? row.created_at,
    } satisfies DonationInterestRow;
  });
}

export async function listBugReports() {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,title,body,created_at,updated_at")
    .like("source_key", "__bug_report__:%")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    try {
      const details = JSON.parse(row.body) as {
        description?: string;
        email?: string | null;
        userId?: string | null;
        userAgent?: string;
        logIds?: number[];
        status?: BugReportRow["status"];
      };
      if (!details.description) return [];
      return [{
        id: row.id,
        user_id: details.userId ?? null,
        reporter_email: details.email ?? null,
        description: details.description,
        page_url: row.title.startsWith("PAGE: ") ? row.title.slice(6) : row.title,
        user_agent: details.userAgent ?? "",
        log_ids: Array.isArray(details.logIds)
          ? details.logIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 30)
          : [],
        status: details.status ?? "new",
        created_at: row.created_at,
        updated_at: row.updated_at ?? row.created_at,
      } satisfies BugReportRow];
    } catch {
      return [];
    }
  });
}

export async function getCommunicationOverview(): Promise<CommunicationOverview> {
  const admin = createSupabaseAdminClient();
  const authUsers: User[] = [];
  const ratingRows: Array<{ id: number; body: string; created_at: string }> = [];

  const loadAuthUsers = async () => {
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      authUsers.push(...data.users);
      if (data.users.length < 1000) break;
    }
  };

  const loadRatings = async () => {
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const { data, error } = await admin
        .from("site_updates")
        .select("id,body,created_at")
        .like("source_key", "__site_rating:%")
        .order("created_at", { ascending: false })
        .range(offset, offset + 999);
      if (error || !data) break;
      ratingRows.push(...data);
      if (data.length < 1000) break;
    }
  };

  const [
    ,
    ,
    approvedPlayersResult,
    pendingApplicationsResult,
    feedPostsResult,
    feedCommentsResult,
    supportRowsResult,
    settingRowsResult,
    telegramRowsResult,
    removedAdminRowsResult,
    bugReports,
    donationInterests,
  ] = await Promise.all([
    loadAuthUsers(),
    loadRatings(),
    admin
      .from("waitlist_applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .eq("is_banned", false)
      .eq("is_deleted", false),
    admin
      .from("waitlist_applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("is_banned", false)
      .eq("is_deleted", false),
    admin.from("pc_feed_posts").select("id", { count: "exact", head: true }),
    admin.from("pc_feed_comments").select("id", { count: "exact", head: true }),
    admin
      .from("site_updates")
      .select("id,source_key,title,body,created_at,updated_at")
      .like("source_key", "__poppers_support:%")
      .order("updated_at", { ascending: false })
      .limit(200),
    admin
      .from("site_updates")
      .select("id,source_key,title,body,created_at,updated_at")
      .in("source_key", ["__maintenance_mode__", "__crash_mode__", "__rating_prompt__"])
      .order("updated_at", { ascending: false }),
    admin
      .from("site_updates")
      .select("id,source_key,title,body,created_at,updated_at")
      .like("source_key", "__telegram_autoreply:%")
      .order("updated_at", { ascending: false })
      .limit(100),
    admin
      .from("site_updates")
      .select("id,source_key,title,body,created_at,updated_at")
      .like("source_key", "__removed_admin:%")
      .order("updated_at", { ascending: false })
      .limit(100),
    listBugReports(),
    listDonationInterests(),
  ]);

  const parseRecord = (value: string) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  };

  const ratings = ratingRows.flatMap((row) => {
    const details = parseRecord(row.body);
    const stars = Number(details.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return [];
    return [{
      id: row.id,
      stars,
      feedback: typeof details.feedback === "string" ? details.feedback : "",
      page_url: typeof details.pageUrl === "string" ? details.pageUrl : "",
      email: typeof details.email === "string" && details.email ? details.email : null,
      created_at: row.created_at,
    } satisfies CommunicationRatingRow];
  });

  type SignalRow = {
    id: number;
    source_key: string | null;
    title: string;
    body: string;
    created_at: string;
    updated_at: string | null;
  };

  const notifications: CommunicationNotificationRow[] = [];
  for (const row of (supportRowsResult.data ?? []) as SignalRow[]) {
    const details = parseRecord(row.body);
    const waiting = details.state === "waiting";
    const text = waiting ? details.question : details.answer;
    notifications.push({
      id: `support-${row.id}`,
      kind: "support",
      title: waiting ? "ПОППЕРС ПОЗВАЛ АДМИНА" : "ОБРАЩЕНИЕ ОТВЕЧЕНО",
      body: typeof text === "string" && text ? text : "Текст обращения недоступен.",
      status: waiting ? "ЖДЁТ ОТВЕТА" : "ОТВЕЧЕНО",
      created_at: row.updated_at ?? row.created_at,
    });
  }

  for (const row of (settingRowsResult.data ?? []) as SignalRow[]) {
    const details = parseRecord(row.body);
    const enabled = details.enabled === true || row.body === "enabled";
    const key = row.source_key ?? "";
    const isRating = key === "__rating_prompt__";
    notifications.push({
      id: `system-${row.id}`,
      kind: "system",
      title: isRating
        ? "ОПРОС ОЦЕНКИ ОБНОВЛЁН"
        : key === "__crash_mode__"
          ? "КРАШ-РЕЖИМ"
          : "ТЕХНИЧЕСКИЙ РЕЖИМ",
      body: isRating
        ? "Пользователи увидят просьбу оценить платформу после обновления страницы."
        : enabled
          ? "Режим включён."
          : "Режим выключен.",
      status: isRating ? "ОТПРАВЛЕН" : enabled ? "ВКЛЮЧЁН" : "ВЫКЛЮЧЕН",
      created_at: row.updated_at ?? row.created_at,
    });
  }

  for (const row of (telegramRowsResult.data ?? []) as SignalRow[]) {
    const details = parseRecord(row.body);
    const enabled = details.enabled !== false;
    notifications.push({
      id: `telegram-${row.id}`,
      kind: "telegram",
      title: "АВТООТВЕТ TELEGRAM",
      body: enabled ? "Автоответ включён для отдельного диалога." : "Администратор отвечает в этом диалоге вручную.",
      status: enabled ? "ВКЛЮЧЁН" : "РУЧНОЙ РЕЖИМ",
      created_at: row.updated_at ?? row.created_at,
    });
  }

  for (const row of (removedAdminRowsResult.data ?? []) as SignalRow[]) {
    notifications.push({
      id: `admin-${row.id}`,
      kind: "admin",
      title: "ПРАВА АДМИНИСТРАТОРА ОТКЛЮЧЕНЫ",
      body: "Учётная запись удалена из активного списка администраторов.",
      status: "ВЫПОЛНЕНО",
      created_at: row.updated_at ?? row.created_at,
    });
  }

  notifications.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const activeSince = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const averageRating = ratings.length
    ? ratings.reduce((total, rating) => total + rating.stars, 0) / ratings.length
    : 0;

  return {
    metrics: {
      registered_accounts: authUsers.length,
      active_last_30_days: authUsers.filter((user) => Date.parse(user.last_sign_in_at ?? "") >= activeSince).length,
      approved_players: approvedPlayersResult.count ?? 0,
      pending_applications: pendingApplicationsResult.count ?? 0,
      feed_posts: feedPostsResult.count ?? 0,
      feed_comments: feedCommentsResult.count ?? 0,
      unresolved_bugs: bugReports.filter((report) => report.status !== "resolved").length,
      rating_count: ratings.length,
      average_rating: Math.round(averageRating * 10) / 10,
    },
    ratings: ratings.slice(0, 200),
    notifications: notifications.slice(0, 300),
    bug_reports: bugReports,
    donation_interests: donationInterests,
  };
}


export async function listModerationProposals(adminId: number) {
  const admin = createSupabaseAdminClient();
  const [{ data, error }, { data: votes, error: votesError }] = await Promise.all([
    admin
      .from("moderation_proposals")
      .select(
        "id,application_id,action,reason,status,created_by,created_at,resolved_at",
      )
      .order("status")
      .order("created_at", { ascending: false }),
    admin
      .from("moderation_votes")
      .select("proposal_id,admin_id,vote"),
  ]);
  if (error) throw error;
  if (votesError) throw votesError;

  return (data ?? []).map((proposal) => {
    const proposalVotes = (votes ?? []).filter(
      (vote) => vote.proposal_id === proposal.id,
    );
    return {
      ...proposal,
      approvals: proposalVotes.filter((vote) => vote.vote === "approve").length,
      rejections: proposalVotes.filter((vote) => vote.vote === "reject").length,
      my_vote:
        (proposalVotes.find((vote) => vote.admin_id === adminId)?.vote as
          | AdminVote
          | undefined) ?? null,
    } as ModerationProposalRow;
  });
}

export async function getApprovedMember() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") return null;

  const { data, error } = await createSupabaseAdminClient()
    .from("waitlist_applications")
    .select("login,who,status,is_banned,is_deleted")
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    error ||
    data?.status !== "approved" ||
    data.is_banned ||
    data.is_deleted
  ) {
    return null;
  }
  return { login: data.login as string, who: data.who as string, userId: user.id };
}

export async function getPlayerWaitlistViewer() {
  const viewer = await getViewerIdentity();
  if (!viewer || viewer.needsMfa) return null;

  const { data: application, error } = await createSupabaseAdminClient()
    .from("waitlist_applications")
    .select("login,who,status,is_banned,is_deleted")
    .eq("user_id", viewer.user.id)
    .maybeSingle();
  const isMember = !error && application?.status === "approved" && !application.is_banned && !application.is_deleted;
  const isAdmin = Boolean(viewer.adminProfile);
  if (!isMember && !isAdmin) return null;

  return {
    login: isMember
      ? String(application?.login)
      : String(viewer.adminProfile?.display_name ?? viewer.user.email?.split("@")[0] ?? "admin"),
    who: isMember ? String(application?.who) : String(viewer.adminProfile?.display_name ?? "Администратор"),
    userId: viewer.user.id,
    isAdmin,
  };
}

export async function listPlayerWaitlist(userId: string) {
  const applications = (await listApplications()).filter(
    (application) => application.status === "pending" && !application.is_deleted,
  );
  const { data: communityRows, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("title,body,source_key,created_at,updated_at")
    .or("title.like.application:%,title.like.review:%,title.like.review-reaction:%,title.like.review-reply:%")
    .eq("published", false);
  if (error) throw error;
  return applications.map((application) => {
    const reviews = (communityRows ?? []).flatMap((row) => {
      if (row.title !== `review:${application.id}` || !row.source_key?.startsWith("__player_review__:")) return [];
      try {
        const parsed = JSON.parse(row.body) as { rating?: number; comment?: string; author?: string };
        const reviewUserId = row.source_key.split(":").at(-1) ?? "";
        const rating = Math.max(1, Math.min(5, Number(parsed.rating) || 0));
        if (!reviewUserId || !rating || typeof parsed.comment !== "string") return [];
        const reactionPrefix = `__player_review_reaction__:${application.id}:${reviewUserId}:`;
        const reactions = (communityRows ?? []).filter((candidate) =>
          candidate.title === `review-reaction:${application.id}` && candidate.source_key?.startsWith(reactionPrefix),
        );
        const replyPrefix = `__player_review_reply__:${application.id}:${reviewUserId}:`;
        const replies = (communityRows ?? []).flatMap((candidate) => {
          if (candidate.title !== `review-reply:${application.id}` || !candidate.source_key?.startsWith(replyPrefix)) return [];
          try {
            const reply = JSON.parse(candidate.body) as { author?: string; comment?: string };
            const replyUserId = candidate.source_key.split(":").at(-1) ?? "";
            if (!replyUserId || typeof reply.comment !== "string" || !reply.comment.trim()) return [];
            return [{
              userId: replyUserId,
              author: String(reply.author ?? "Игрок"),
              comment: reply.comment,
              createdAt: candidate.updated_at ?? candidate.created_at,
            } satisfies PlayerReviewReply];
          } catch {
            return [];
          }
        }).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
        const myReaction = reactions.find((reaction) => reaction.source_key?.endsWith(`:${userId}`))?.body;
        return [{
          userId: reviewUserId,
          author: String(parsed.author ?? "Игрок"),
          rating,
          comment: parsed.comment,
          createdAt: row.updated_at ?? row.created_at,
          likes: reactions.filter((reaction) => reaction.body === "like").length,
          dislikes: reactions.filter((reaction) => reaction.body === "dislike").length,
          myReaction: myReaction === "like" || myReaction === "dislike" ? myReaction : null,
          replies,
          myReply: replies.find((reply) => reply.userId === userId) ?? null,
        } satisfies PlayerReview];
      } catch {
        return [];
      }
    });
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    return {
      id: application.id,
      login: application.login,
      who: application.who,
      from_where: application.from_where,
      why_server: application.why_server,
      why_you: application.why_you,
      favorite_music: application.favorite_music,
      social_links: application.social_links,
      skin_url: application.skin_url,
      created_at: application.created_at,
      player_approvals: application.player_approvals,
      player_rejections: application.player_rejections,
      my_player_vote:
        ((communityRows ?? []).find(
          (vote) => vote.source_key === `__player_vote__:${application.id}:${userId}`,
        )?.body as "approve" | "reject" | undefined) ?? null,
      reviews,
      my_review: reviews.find((review) => review.userId === userId) ?? null,
      average_rating: reviews.length ? totalRating / reviews.length : 0,
    } satisfies PlayerApplicationRow;
  });
}
