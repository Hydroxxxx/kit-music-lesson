import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect("/login?deactivated=1");
  }

  return <AppShell initialProfile={profile}>{children}</AppShell>;
}

