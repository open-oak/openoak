import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("inline-flex items-center text-3xl font-black leading-none tracking-normal text-foreground", className)}>
      OpenOak
    </div>
  );
}
