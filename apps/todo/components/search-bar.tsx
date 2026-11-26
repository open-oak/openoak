"use client";

import { Search, X, ListFilter, CalendarDays, Clock3, Star, Circle, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, useRef, useTransition } from "react";
import { searchTasks } from "@/app/actions";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ActionRow from "@/components/action-row";

type SearchScope = "all" | "today" | "upcoming" | "important";

interface SearchResult {
  id: string;
  title: string;
  isCompleted: boolean;
  isImportant: boolean;
}

const PAGE_SIZE = 20;
export default function SearchBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const latestRequestRef = useRef(0);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      const normalizedQuery = query.trim().toLowerCase();
      const shouldFetch = Boolean(normalizedQuery) || scope !== "all";

      if (shouldFetch) {
        const requestId = ++latestRequestRef.current;
        setIsSearching(true);
        setResults([]);
        setTotalCount(0);
        setNextCursor(null);
        setCurrentCursor(null);
        setCursorHistory([]);
        startTransition(async () => {
          try {
            const data = await searchTasks(normalizedQuery, scope, PAGE_SIZE);
            if (requestId !== latestRequestRef.current) return;
            setResults(data.items);
            setTotalCount(data.totalCount);
            setNextCursor(data.nextCursor);
          } catch {
            if (requestId === latestRequestRef.current) toast.error("Search failed");
          } finally {
            if (requestId === latestRequestRef.current) setIsSearching(false);
          }
        });
      } else {
        latestRequestRef.current += 1;
        setIsSearching(false);
        setResults([]);
        setTotalCount(0);
        setNextCursor(null);
        setCurrentCursor(null);
        setCursorHistory([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [isOpen, query, scope, startTransition]);

  const closeSearch = () => {
    setIsOpen(false);
    setQuery("");
    setScope("all");
    setResults([]);
    setTotalCount(0);
    setNextCursor(null);
    setCurrentCursor(null);
    setCursorHistory([]);
  };

  // Ctrl+K / Cmd+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape" && isOpen) {
        closeSearch();
      }
    };
    const openHandler = () => setIsOpen(true);
    document.addEventListener("keydown", handler);
    window.addEventListener("open-search", openHandler);
    return () => {
      document.removeEventListener("keydown", handler);
      window.removeEventListener("open-search", openHandler);
    };
  }, [isOpen]);

  const loadPage = async (cursor: string | null, history: Array<string | null>) => {
    if (isSearching) return;
    setIsSearching(true);
    const normalizedQuery = query.trim().toLowerCase();
    const requestId = ++latestRequestRef.current;
    try {
      const data = await searchTasks(normalizedQuery, scope, PAGE_SIZE, cursor);
      if (requestId !== latestRequestRef.current) return;
      setResults(data.items);
      setTotalCount(data.totalCount);
      setNextCursor(data.nextCursor);
      setCurrentCursor(cursor);
      setCursorHistory(history);
    } catch {
      if (requestId === latestRequestRef.current) toast.error("Search failed");
    } finally {
      if (requestId === latestRequestRef.current) setIsSearching(false);
    }
  };

  const loadNext = () => {
    if (!nextCursor) return;
    void loadPage(nextCursor, [...cursorHistory, currentCursor]);
  };

  const loadPrevious = () => {
    if (cursorHistory.length === 0) return;
    void loadPage(cursorHistory.at(-1) ?? null, cursorHistory.slice(0, -1));
  };

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    closeSearch();
  };

  if (!isOpen) return null;

  return (
    <div
      className="todo-mobile-viewport-overlay todo-mobile-search-overlay fixed inset-0 z-50 flex justify-center items-start pt-[13vh] pb-32 max-md:pt-0 max-md:pb-0 bg-black/30"
      onClick={closeSearch}
    >
      <div
        className={cn(
          "w-full mx-4 max-md:mx-0 max-md:max-w-none max-md:h-full max-md:rounded-none overflow-hidden flex flex-col min-h-0 max-h-full",
          // Desktop: transparent card matching settings/appearance picker
          "md:max-w-[580px] md:rounded-2xl md:bg-card/95 md:shadow-2xl md:ring-1 md:ring-border/60 md:animate-in md:fade-in-0 md:zoom-in-95 md:duration-150",
          // Mobile: solid popover with slide from top
          "max-md:bg-popover max-md:border max-md:shadow-2xl max-md:animate-in max-md:fade-in-0 max-md:slide-in-from-top-2 max-md:duration-150",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-border/60">
          <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks..."
            className="flex-1 bg-transparent py-4 px-3 text-[15px] max-md:text-base border-none focus:outline-none placeholder:text-muted-foreground/60"
          />
          <button
            onClick={closeSearch}
            className="min-h-11 min-w-11 p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-accent rounded-lg transition-colors md:min-h-0 md:min-w-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scope filters */}
        <div className="flex items-center px-3 py-2.5 border-b border-border/60 gap-1.5 max-md:px-2 max-md:gap-1">
          {([
            { value: "all", label: "All", icon: ListFilter },
            { value: "today", label: "Today", icon: CalendarDays },
            { value: "upcoming", label: "Upcoming", icon: Clock3 },
            { value: "important", label: "Important", icon: Star },
          ] as const).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setScope(item.value)}
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all max-md:py-2.5",
                  scope === item.value
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {results.length > 0 ? (
            <div className="py-1.5">
              {results.map((task) => (
                <ActionRow
                  key={task.id}
                  onClick={() => selectTask(task.id)}
                  icon={task.isCompleted
                    ? <CheckCircle2 className="w-5 h-5" />
                    : <Circle className="w-5 h-5" />}
                  label={task.title}
                  trailing={task.isImportant ? <Star className="w-4 h-4 fill-foreground/60 text-foreground/60" /> : undefined}
                  className="px-4 py-3 gap-3 hover:bg-accent/60 max-md:py-3.5"
                  iconClassName={task.isCompleted ? "text-muted-foreground" : "text-muted-foreground/40"}
                  labelClassName={cn(
                    "text-[14.5px] max-md:text-base truncate",
                    task.isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                  )}
                />
              ))}
            </div>
          ) : null}
          {results.length > 0 && totalCount > PAGE_SIZE && (
            <nav className="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2" aria-label="Search result pages">
              <button
                type="button"
                onClick={loadPrevious}
                disabled={cursorHistory.length === 0 || isSearching}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-40"
              >
                <ChevronLeft className="size-4" /> Previous
              </button>
              <span className="text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">
                {cursorHistory.length * PAGE_SIZE + 1}–{Math.min(cursorHistory.length * PAGE_SIZE + results.length, totalCount)} of {totalCount}
              </span>
              <button
                type="button"
                onClick={loadNext}
                disabled={!nextCursor || isSearching}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-40"
              >
                Next <ChevronRight className="size-4" />
              </button>
            </nav>
          )}
          {isSearching && results.length === 0 ? (
            <div className="px-4 py-14 text-center text-[15px] text-muted-foreground/60 max-md:text-base">
              Searching...
            </div>
          ) : null}
          {!isSearching && results.length === 0 && (query || scope !== "all") ? (
            <div className="px-4 py-14 text-center text-[15px] text-muted-foreground/60 max-md:text-base">
              No tasks found
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
