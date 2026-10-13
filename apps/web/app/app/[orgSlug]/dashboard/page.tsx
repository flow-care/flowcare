import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard | Flowcare" };

export default function DashboardPage() {
  return (
    <div className="flex-1">
      <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Acompanhe as atividades da clínica por aqui.
      </p>
    </div>
  );
}
