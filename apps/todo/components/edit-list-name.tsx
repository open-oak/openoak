"use client";

import { Edit2 } from "lucide-react";
import { useState, useRef, useEffect, useTransition } from "react";
import { updateList } from "@/app/actions";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/app-store";

export default function EditListName({
  listId,
  currentName,
}: {
  listId: string;
  currentName: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const lists = useAppStore((s) => s.lists);
  const setLists = useAppStore((s) => s.setLists);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== currentName) {
      // Optimistic update
      setLists(lists.map((l) => l.id === listId ? { ...l, name: trimmed } : l));
      startTransition(async () => {
        const result = await updateList(listId, trimmed);
        if (result?.error) {
          setLists(lists);
          setName(currentName);
        }
        router.refresh();
      });
    } else {
      setName(currentName);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      setName(currentName);
      setIsEditing(false);
    }
  };

  if (!isEditing) {
    return (
      <span
        className="group/edit flex w-full max-w-full items-center justify-center gap-2 cursor-pointer min-w-0"
        onClick={() => setIsEditing(true)}
      >
        <span
          className="truncate leading-none pb-1 text-center max-w-full"
        >
          {currentName}
        </span>
        <Edit2 className="hidden md:block w-4 h-4 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity flex-shrink-0" />
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={handleSave}
      onKeyDown={handleKeyDown}
      maxLength={255}
      className="text-inherit leading-none font-semibold bg-transparent border-none focus:ring-0 focus:outline-none px-0 pt-0 pb-1 w-full text-center"
    />
  );
}
