import { Card } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed bg-white/70 text-center">
      <div className="space-y-2 py-4">
        <h3 className="text-base font-semibold text-[var(--color-text)]">{title}</h3>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
    </Card>
  );
}
