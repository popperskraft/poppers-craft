import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { WikiArticleEditor } from "../WikiArticleEditor";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";
import { listWikiDrafts } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function NewWikiArticlePage() {
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl("/wiki/new"));
  if (identity.needsMfa) redirect("/mfa?next=/wiki/new");
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  /* Вход есть, но профиль сообщества не открылся — окно входа тут не поможет. */
  if (!viewer) redirect("/");
  const drafts = await listWikiDrafts(viewer);

  return (
    <main className="wiki-page wiki-editor-page">
      <WikiArticleEditor userId={viewer.user.id} />
      {drafts.length ? (
        <section className="wiki-drafts">
          <h2>МОИ ЧЕРНОВИКИ</h2>
          <div>{drafts.map((draft) => <Link href={`/wiki/articles/${draft.slug}/edit`} key={draft.id}><strong>{draft.title}</strong><span>ИЗМЕНЁН {new Intl.DateTimeFormat("ru-RU").format(new Date(draft.updatedAt))} →</span></Link>)}</div>
        </section>
      ) : null}
    </main>
  );
}
