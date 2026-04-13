import { cn } from "@/lib/utils";

/**
 * Shared empty-state block used by tables and cards across the app.
 * Dashboard page has its own inline copy; keep them in sync if you change
 * the visual style meaningfully.
 */
export function EmptyState({
  icon,
  title,
  description,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border py-10 text-center",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="max-w-md text-xs text-muted-foreground">
        {description}
      </div>
    </div>
  );
}
