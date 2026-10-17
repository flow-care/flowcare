import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeSelector } from "@/components/flowcare/app/theme-selector";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/invites";
import { getSessionToken } from "@/server/session";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/app" aria-label="Voltar para o aplicativo">
                <ArrowLeft className="size-4" />
                <span className="hidden sm:inline">Voltar</span>
              </Link>
            </Button>
            <div className="h-4 w-px bg-border" />
            <Link
              href="/app"
              className="flex items-center gap-2"
              aria-label="Flowcare — início"
            >
              <Image
                src="/logo-1.png"
                alt="Flowcare"
                width={1024}
                height={409}
                className="h-auto w-24"
              />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {user.fullName}
              </span>
            )}
            <ThemeSelector />
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
