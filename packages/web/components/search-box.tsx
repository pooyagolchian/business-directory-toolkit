"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

interface Suggestion {
  slug: string;
  title: string;
  label: string;
}

/**
 * Search-as-you-type.
 *
 * Every keystroke is a request, so this is the one place in the app where
 * latency is felt directly. Three things keep it honest: a debounce, an
 * AbortController so a slow response can never overwrite a newer one, and a
 * request counter so out-of-order replies are discarded rather than rendered.
 *
 * All colours come from the SEMANTIC tokens (--surface, --field-border), never
 * the palette. Reaching past that layer is what made the hover state render
 * white-on-white in dark mode.
 */
export function SearchBox({
  initialQuery = "",
  placeholder = "Search businesses, categories, or a +971 number",
  size = "lg",
}: {
  initialQuery?: string;
  placeholder?: string;
  size?: "lg" | "sm";
}) {
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const latest = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const requestId = ++latest.current;

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/typeahead?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { suggestions: Suggestion[] };
        // Discard a stale reply that lost the race to a newer keystroke.
        if (requestId !== latest.current) return;
        setSuggestions(data.suggestions);
        setOpen(data.suggestions.length > 0);
        setActive(-1);
      } catch {
        // Aborted or offline — leaving the previous suggestions up is kinder
        // than blanking the list under the user's cursor.
      }
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickAway(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  /**
   * Cmd+K (or Ctrl+K) and "/" both focus search.
   *
   * Cmd+K works from anywhere including inside another field, because it is an
   * explicit chord the user meant. "/" only works when not already typing,
   * since otherwise it would swallow a literal slash mid-word.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

      const chord = (event.metaKey || event.ctrlKey) && event.key === "k";
      if (chord || (event.key === "/" && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Rendered only after mount: the hint differs per platform, and guessing on
  // the server would hydrate the wrong glyph for half the audience.
  const [chordHint, setChordHint] = useState<string | null>(null);
  useEffect(() => {
    const mac = /mac|iphone|ipad/i.test(navigator.userAgent);
    setChordHint(mac ? "\u2318K" : "Ctrl K");
  }, []);

  function submit(value: string) {
    if (!value.trim()) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(value)}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (event.key === "Enter") submit(query);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[active];
      if (chosen) router.push(`/business/${chosen.slug}`);
      else submit(query);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const large = size === "lg";

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="sr-only">
        Search Dubai businesses
      </label>

      <div
        className={`group flex items-center gap-3 border bg-[var(--field-bg)] transition-colors
          border-[var(--field-border)] hover:border-[var(--field-border-hover)]
          focus-within:border-[var(--field-border-active)]
          ${large ? "px-4 py-3.5" : "px-3 py-2"}`}
      >
        <Search
          aria-hidden="true"
          strokeWidth={1.5}
          className={`shrink-0 text-[var(--muted)] transition-colors group-focus-within:text-[var(--fg)] ${
            large ? "h-5 w-5" : "h-4 w-4"
          }`}
        />

        <input
          ref={inputRef}
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={
            active >= 0 ? `${id}-option-${active}` : undefined
          }
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          // The field itself carries no ring; the wrapper's border is the focus
          // affordance, so the control reads as one object.
          className={`w-full min-w-0 bg-transparent outline-none placeholder:text-[var(--muted)] ${
            large ? "text-lg" : "text-sm"
          }`}
        />

        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSuggestions([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="shrink-0 px-1 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            <X
              aria-hidden="true"
              strokeWidth={1.5}
              className={large ? "h-4 w-4" : "h-3.5 w-3.5"}
            />
          </button>
        ) : (
          large &&
          chordHint && (
            <kbd className="hidden shrink-0 border border-[var(--rule)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)] sm:block">
              {chordHint}
            </kbd>
          )
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden border border-[var(--rule)] bg-[var(--surface)] shadow-[var(--surface-shadow)]"
        >
          {suggestions.map((s, i) => (
            <div
              key={s.slug}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // mousedown, not click: the click-away listener fires first and
                // would close the list before a click could land.
                e.preventDefault();
                router.push(`/business/${s.slug}`);
              }}
              className={`flex cursor-pointer flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors ${
                i === active ? "bg-[var(--surface-hover)]" : ""
              }`}
            >
              <span dir="auto" className="line-clamp-1 text-sm">
                {s.title}
              </span>
              {s.label && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  {s.label}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
