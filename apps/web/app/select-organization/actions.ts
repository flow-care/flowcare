"use server";

import { setActiveOrganization } from "@/server/organizations";

export async function chooseOrganization(orgSlug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(orgSlug)) return false;
  return setActiveOrganization(orgSlug);
}
