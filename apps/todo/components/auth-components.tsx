"use client";

import Link from "next/link";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AuthPageShell({
  children,
  footer,
  logoSize = 48,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  logoSize?: number;
}) {
  return (
    <div className="flex items-center justify-center min-h-dvh bg-background p-4">
      <div className="w-full max-w-sm">
        <AuthBrand logoSize={logoSize} />
        {children}
        {footer}
      </div>
    </div>
  );
}

export function AuthBrand({ logoSize = 48 }: { logoSize?: number }) {
  return (
    <div className="flex flex-col items-center gap-2 mb-8">
      <Logo size={logoSize} className="text-foreground" />
      <h1 className="text-2xl font-bold text-foreground">Open Todo</h1>
    </div>
  );
}

export function AuthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-card/60 shadow-sm ring-1 ring-border p-6", className)}>
      {children}
    </div>
  );
}

export function AuthMessage({
  children,
  tone = "error",
  className,
}: {
  children: React.ReactNode;
  tone?: "error" | "success" | "muted";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 rounded-lg text-sm px-4 py-3",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "success" && "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20",
        tone === "muted" && "bg-muted/50 border border-border text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

export function AuthField({
  id,
  label,
  action,
  className,
  inputClassName,
  ...props
}: React.ComponentProps<"input"> & {
  id: string;
  label: string;
  action?: React.ReactNode;
  inputClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {action}
      </div>
      <Input
        id={id}
        className={cn(
          "h-11 rounded-lg border-border bg-background px-3 text-sm focus-visible:ring-2 placeholder:text-muted-foreground",
          inputClassName
        )}
        {...props}
      />
    </div>
  );
}

export function AuthSubmitButton({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="submit"
      className={cn("h-11 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function AuthLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("text-foreground font-medium hover:underline", className)}>
      {children}
    </Link>
  );
}

export function AuthLoadingCard() {
  return (
    <AuthCard className="h-[400px] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </AuthCard>
  );
}
