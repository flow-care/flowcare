export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="flex-1">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        Este módulo estará disponível em breve.
      </p>
    </div>
  );
}
