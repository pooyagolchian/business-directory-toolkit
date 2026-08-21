"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
 * The origin is us-east-1 and the audience is in Dubai (~250ms) — see
 * docs/adr/0003-deploy-region.md. That distance is exactly why this endpoint
 * is deliberately tiny and separate from the SSR path.
 */
export function SearchBox({
  autoFocus = false,
  initialQuery = "",
  placeholder = "Search businesses, categories, or a +971 number",
}: {
  autoFocus?: boolean;
  initialQuery?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const latest = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
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
        setOpen(true);
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
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={listId} className="sr-only">
        Search Dubai businesses
      </label>
      <input
        id={listId}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        value={query}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        className="w-full border-b border-[var(--fg)] bg-transparent pb-3 text-lg outline-none placeholder:text-[var(--muted)] focus-visible:outline-none sm:text-xl"
      />

      {open && suggestions.length > 0 && (
        <ul
          id={`${listId}-listbox`}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-px border border-[var(--rule)] bg-[var(--bg)] shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.slug} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => router.push(`/business/${s.slug}`)}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left ${
                  i === active ? "bg-[var(--color-ink-100)]" : ""
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
