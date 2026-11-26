"use client";

import { useParams } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import ListPageLayout from "@/components/list-page-layout";

export default function Loading() {
  const { listId } = useParams() as { listId: string };
  const lists = useAppStore((s) => s.lists);
  const list = lists.find((l) => l.id === listId);

  if (!list) return null;

  return (
    <ListPageLayout
      listId={listId}
      listName={list.name}
      currentBg={list.backgroundImage}
      currentTheme={list.themeColor}
    />
  );
}
