import { redirect } from "next/navigation";

export default async function SettingsHoursPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/app/${encodeURIComponent(orgSlug)}/settings/schedules`);
}
