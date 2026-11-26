import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import DataHydrator from "@/components/data-hydrator";
import { BackgroundPrefetcher } from "@/components/background-prefetcher";
import PersistentBackground from "@/components/persistent-background";
import VirtualRouter from "@/components/virtual-router";
import { AppSidebar } from "@/components/app-sidebar";
import TaskDetailPanel from "@/components/task-detail-panel";
import SearchBar from "@/components/search-bar";
import KeyboardShortcuts from "@/components/keyboard-shortcuts";
import SettingsMenu from "@/components/settings-menu";
import ClientErrorBoundary from "@/components/client-error-boundary";
import Logo from "@/components/logo";
import { MobileViewportSync } from "@/components/mobile-viewport-sync";
import { Suspense } from "react";
import { CollaborationSync } from "@/components/collaboration-sync";
import { TaskViewPrefetcher } from "@/components/task-view-prefetcher";

function InitialAppLoading() {
  return (
    <div className="flex h-dvh w-full items-center justify-center px-6">
      <div className="flex flex-col items-center gap-5 text-center">
        <Logo className="text-primary" />
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden />
        <p className="text-sm font-semibold text-muted-foreground" role="status">
          Opening OpenTodo
        </p>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<InitialAppLoading />}>
      <DataHydrator>
        <MobileViewportSync />
        <BackgroundPrefetcher />
        <TaskViewPrefetcher />
        <CollaborationSync />
        <TooltipProvider>
          <PersistentBackground />
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <ClientErrorBoundary
                title="Couldn’t render this list"
                description="Try again to reload the task view."
              >
                <VirtualRouter />
                {children}
              </ClientErrorBoundary>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <ClientErrorBoundary
          title="Couldn’t open task details"
          description="Try again to reopen the task panel."
        >
          <TaskDetailPanel />
        </ClientErrorBoundary>
        <SearchBar />
        <KeyboardShortcuts />
        <SettingsMenu />
        <Toaster />
      </DataHydrator>
    </Suspense>
  );
}
