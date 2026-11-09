import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth";

export default async function AccountsAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect("/login?deactivated=1");
  }

  if (profile.role !== "admin") {
    redirect("/schedule");
  }

  return <>{children}</>;
}

