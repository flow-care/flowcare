import { redirect } from "next/navigation";

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/app/${encodeURIComponent(orgSlug)}/dashboard`);
}
