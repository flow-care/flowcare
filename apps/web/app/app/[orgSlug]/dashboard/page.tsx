import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard | Flowcare" };

export default function DashboardPage() {
  return (
    <div className="flex-1 px-5 py-8 md:px-8 md:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          Acompanhe as atividades da clínica por aqui.
        </p>
      </div>
    </div>
  );
}
