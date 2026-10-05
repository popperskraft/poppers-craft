import { AdminDashboard } from "./AdminDashboard";
import {
  getAdminUser,
  listAdmins,
  listApplications,
  listModerationProposals,
  getSiteSettings,
  listSiteUpdates,
  getCommunicationOverview,
} from "@/lib/waitlist";
import { AdminLogin } from "./AdminLogin";
import { listLauncherReleases } from "@/lib/launcher-releases";
import { listSiteErrorLogs } from "@/lib/error-logs";
import { listAgreementAcceptances } from "@/lib/user-agreement-store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getAdminUser();
  if (!user) {
    return <AdminLogin />;
  }

  const [applications, admins, updates, communication, proposals, settings, launcherReleases, errorLogs, agreementAcceptances] = await Promise.all([
    listApplications(user.profile.id),
    listAdmins(),
    listSiteUpdates(),
    getCommunicationOverview(),
    listModerationProposals(user.profile.id),
    getSiteSettings(),
    listLauncherReleases({ includeArchived: true }),
    listSiteErrorLogs(),
    listAgreementAcceptances(),
  ]);

  return (
    <AdminDashboard
      currentAdmin={user.profile}
      currentUserId={user.user.id}
      initialApplications={applications}
      initialAdmins={admins}
      initialUpdates={updates}
      initialCommunication={communication}
      initialProposals={proposals}
      initialSettings={settings}
      initialLauncherReleases={launcherReleases}
      initialErrorLogs={errorLogs}
      initialErrorLogsAt={new Date().toISOString()}
      initialAgreementAcceptances={agreementAcceptances}
    />
  );
}
