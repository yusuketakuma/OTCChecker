export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-brand)]">
        {eyebrow}
      </p>
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">{title}</h1>
        <p className="max-w-xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </header>
  );
}
