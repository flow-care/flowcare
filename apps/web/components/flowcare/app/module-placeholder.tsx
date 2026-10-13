export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="flex-1 px-5 py-8 md:px-8 md:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground">
          Este módulo estará disponível em breve.
        </p>
      </div>
    </div>
  );
}
