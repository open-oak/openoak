import { getSidebarData, getUserSettings } from "@/app/actions";
import { StoreInitializer } from "./store-initializer";

export default async function DataHydrator({ children }: { children: React.ReactNode }) {
  const [sidebarData, userSettings] = await Promise.all([
    getSidebarData(),
    getUserSettings(),
  ]);

  return (
    <StoreInitializer
      lists={sidebarData.lists}
      counts={sidebarData.counts}
      defaultListId={sidebarData.defaultListId}
      userSettings={userSettings}
    >
      {children}
    </StoreInitializer>
  );
}
