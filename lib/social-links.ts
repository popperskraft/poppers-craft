export const SOCIAL_LINK_FIELDS = [
  { key: "telegram", name: "socialTelegram", icon: "telegram", label: "Telegram", placeholder: "@username или t.me/username" },
  { key: "discord", name: "socialDiscord", icon: "discord", label: "Discord", placeholder: "ID пользователя или discord.com/users/ID" },
  { key: "youtube", name: "socialYoutube", icon: "youtube", label: "YouTube", placeholder: "@channel или youtube.com/@channel" },
  { key: "tiktok", name: "socialTiktok", icon: "tiktok", label: "TikTok", placeholder: "@username или ссылка" },
  { key: "instagram", name: "socialInstagram", icon: "instagram", label: "Instagram", placeholder: "@username или ссылка" },
  { key: "letterboxd", name: "socialLetterboxd", icon: "letterboxd", label: "Letterboxd", placeholder: "letterboxd.com/username или username" },
  { key: "duolingo", name: "socialDuolingo", icon: "duolingo", label: "Duolingo", placeholder: "duolingo.com/profile/username или username" },
] as const;

export type SocialLinkKey = typeof SOCIAL_LINK_FIELDS[number]["key"];

export type StructuredSocialLinks = Record<SocialLinkKey, string> & {
  other: string;
};

function toHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(trimmed)
      ? `https://${trimmed}`
      : "";
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function profileName(value: string, domains: string[], pathPrefix = "") {
  const httpUrl = toHttpUrl(value);
  if (httpUrl) {
    const url = new URL(httpUrl);
    if (!domains.some((domain) => url.hostname === domain || url.hostname === `www.${domain}`)) return /^[\p{L}\p{N}_.-]+$/u.test(value.trim()) ? value.trim() : "";
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    const withoutPrefix = pathPrefix && path.toLowerCase().startsWith(`${pathPrefix.toLowerCase()}/`)
      ? path.slice(pathPrefix.length + 1)
      : path;
    try { return decodeURIComponent(withoutPrefix.split("/")[0] ?? "").replace(/^@/, ""); } catch { return ""; }
  }
  return value.trim().replace(/^@/, "").replace(/^\/+|\/+$/g, "");
}

function safeProfileName(value: string) {
  return /^[\p{L}\p{N}_.-]{1,80}$/u.test(value) ? value : "";
}

function trustedDirectUrl(value: string, domains: string[]) {
  const directUrl = toHttpUrl(value);
  if (!directUrl) return null;
  const url = new URL(directUrl);
  return domains.some((domain) => url.hostname === domain || url.hostname === `www.${domain}`) ? directUrl : null;
}

export function socialProfileUrl(key: SocialLinkKey, value: string) {
  if (!value.trim()) return null;
  let username = "";
  switch (key) {
    case "telegram": {
      const directUrl = trustedDirectUrl(value, ["t.me", "telegram.me"]);
      if (directUrl) return directUrl;
      username = safeProfileName(profileName(value, ["t.me", "telegram.me"]));
      return username ? `https://t.me/${encodeURIComponent(username)}` : null;
    }
    case "discord": {
      const directUrl = trustedDirectUrl(value, ["discord.com", "discord.gg"]);
      if (directUrl) {
        const url = new URL(directUrl);
        if (/^\/users\/\d{5,24}\/?$/.test(url.pathname) || /^\/invite\/[\w-]+\/?$/.test(url.pathname) || (url.hostname === "discord.gg" && /^\/[\w-]+\/?$/.test(url.pathname))) return directUrl;
        return null;
      }
      const discordId = value.trim().replace(/^@/, "");
      return /^\d{5,24}$/.test(discordId)
        ? `https://discord.com/users/${discordId}`
        : null;
    }
    case "youtube": {
      const directUrl = trustedDirectUrl(value, ["youtube.com", "youtu.be"]);
      if (directUrl) return directUrl;
      username = safeProfileName(profileName(value, ["youtube.com", "youtu.be"]));
      return username ? `https://www.youtube.com/@${encodeURIComponent(username)}` : null;
    }
    case "tiktok": {
      const directUrl = trustedDirectUrl(value, ["tiktok.com"]);
      if (directUrl) return directUrl;
      username = safeProfileName(profileName(value, ["tiktok.com"]));
      return username ? `https://www.tiktok.com/@${encodeURIComponent(username)}` : null;
    }
    case "instagram": {
      const directUrl = trustedDirectUrl(value, ["instagram.com"]);
      if (directUrl) return directUrl;
      username = safeProfileName(profileName(value, ["instagram.com"]));
      return username ? `https://www.instagram.com/${encodeURIComponent(username)}/` : null;
    }
    case "letterboxd": {
      const directUrl = trustedDirectUrl(value, ["letterboxd.com"]);
      if (directUrl) return directUrl;
      username = safeProfileName(profileName(value, ["letterboxd.com"]));
      return username ? `https://letterboxd.com/${encodeURIComponent(username)}/` : null;
    }
    case "duolingo": {
      const directUrl = trustedDirectUrl(value, ["duolingo.com"]);
      if (directUrl) return directUrl;
      username = safeProfileName(profileName(value, ["duolingo.com"], "profile"));
      return username ? `https://www.duolingo.com/profile/${encodeURIComponent(username)}` : null;
    }
  }
}

export function otherSocialUrl(value: string) {
  return toHttpUrl(value);
}

// Existing imperfect contacts remain editable; reject only new invalid values.
export function socialLinksError(value: string, previous: string | null = "") {
  const links = parseSocialLinks(value), old = parseSocialLinks(previous);
  for (const field of SOCIAL_LINK_FIELDS) {
    if (links[field.key] && links[field.key] !== old[field.key] && !socialProfileUrl(field.key, links[field.key])) {
      return field.key === "discord"
        ? "Discord: укажите ссылку на профиль, приглашение или ID пользователя. По нику профиль не открывается."
        : `Проверьте контакт ${field.label}: нужен ник или ссылка на эту платформу.`;
    }
  }
  if (links.other !== old.other && links.other.split(/\r?\n/).some(line => line.trim() && !otherSocialUrl(line))) return "В поле «Другое» добавьте ссылки на сайты — по одной на строку.";
  return "";
}

function emptySocialLinks(): StructuredSocialLinks {
  return {
    telegram: "",
    discord: "",
    youtube: "",
    tiktok: "",
    instagram: "",
    letterboxd: "",
    duolingo: "",
    other: "",
  };
}

const labelToKey = new Map<string, SocialLinkKey>(
  SOCIAL_LINK_FIELDS.map((field) => [field.label.toLocaleLowerCase("ru-RU"), field.key]),
);

function appendValue(current: string, value: string) {
  return current ? `${current}\n${value}` : value;
}

export function parseSocialLinks(value: string | null | undefined): StructuredSocialLinks {
  const parsed = emptySocialLinks();

  String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separator = line.indexOf(":");
      if (separator < 0) {
        parsed.other = appendValue(parsed.other, line);
        return;
      }

      const label = line.slice(0, separator).trim().toLocaleLowerCase("ru-RU");
      const fieldValue = line.slice(separator + 1).trim();
      if (!fieldValue) return;

      if (label === "другое") {
        parsed.other = appendValue(parsed.other, fieldValue);
        return;
      }

      const key = labelToKey.get(label);
      if (key) {
        parsed[key] = appendValue(parsed[key], fieldValue);
      } else {
        parsed.other = appendValue(parsed.other, line);
      }
    });

  return parsed;
}

export function collectSocialLinks(body: Record<string, unknown> | null | undefined) {
  const source = body ?? {};
  const structuredFieldNames = [...SOCIAL_LINK_FIELDS.map((field) => field.name), "socialOther"];
  const hasStructuredFields = structuredFieldNames.some((name) =>
    Object.prototype.hasOwnProperty.call(source, name),
  );

  if (!hasStructuredFields) return String(source.socialLinks ?? "").trim();

  const lines = SOCIAL_LINK_FIELDS.flatMap((field) => {
    const fieldValue = String(source[field.name] ?? "")
      .replace(/\s*\r?\n\s*/g, " ")
      .trim();
    return fieldValue ? [`${field.label}: ${fieldValue}`] : [];
  });

  const otherLines = String(source.socialOther ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `Другое: ${line}`);

  return [...lines, ...otherLines].join("\n");
}
