"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FollowButton({ login, initiallyFollowing }: { login: string; initiallyFollowing: boolean }) {
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState(initiallyFollowing);
  const router = useRouter();
  return <button className={following ? "player-follow is-following" : "player-follow"} disabled={busy} onClick={async () => {
    setBusy(true);
    const response = await fetch(`/api/profiles/${login}/follow`, { method: "POST" });
    const result = await response.json();
    setBusy(false);
    if (response.ok) { setFollowing(Boolean(result.following)); router.refresh(); }
  }}>{busy ? "..." : following ? "ОТПИСАТЬСЯ" : "+ ПОДПИСАТЬСЯ"}</button>;
}
