import Link from "next/link";
import { SORT_KEYS, SORT_LABELS, toggleFilter } from "@directory/core";
import type {
  BusinessFilter,
  FacetGroup,
  FacetGroups,
  FacetValue,
  SortKey,
} from "@directory/core";
import { searchHref } from "@/lib/search-url";

/**
 * The filter controls on /search.
 *
 * Every control is a link, and the whole thing is a Server Component with no
 * client JavaScript at all. That is not minimalism for its own sake: the
 * filtering happens on the server because the result set is far larger than the
 * page (see packages/core/src/facets.ts), so a client control would have had to
 * navigate anyway. Links get the back button, shareable URLs, middle-click, and
 * working filters before hydration, for nothing.
 *
 * Counts are the point of the chips. Each one says how many results the link
 * leads to, computed over every match rather than the fifty on screen, so the
 * reader can tell a useful cut from a dead end before clicking it.
 */

/** Values shown before the rest fold into a disclosure. */
const VISIBLE_VALUES = 8;

interface Chip {
  key: string;
  label: string;
  href: string;
  selected: boolean;
  count?: number;
}

function ChipLink({ chip }: { chip: Chip }) {
  return (
    <Link
      href={chip.href}
      // These are 60-odd links to a dynamic, uncacheable, noindex route. Left
      // on `auto` they would each speculatively hit the server as they scrolled
      // into view, to warm a navigation most readers will never make.
      prefetch={false}
      // aria-current, not aria-pressed: a link is not a button, and the state
      // being described is "this is the filter you are looking at".
      aria-current={chip.selected ? "true" : undefined}
      className={`inline-flex items-baseline gap-1.5 text-sm underline-offset-4 transition-colors ${
        chip.selected
          ? "text-[var(--fg)] underline"
          : "text-[var(--muted)] hover:text-[var(--fg)]"
      }`}
    >
      <span dir="auto">{chip.label}</span>
      {chip.count !== undefined && (
        <span className="tabular text-2xs text-[var(--muted)]">
          {chip.count.toLocaleString()}
        </span>
      )}
    </Link>
  );
}

function ChipList({ chips }: { chips: Chip[] }) {
  return (
    <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
      {chips.map((chip) => (
        <li key={chip.key}>
          <ChipLink chip={chip} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One labelled row of chips.
 *
 * A long list folds into a `<details>` rather than a "show more" button, which
 * keeps the row zero-JavaScript like the rest of the control.
 *
 * When it folds, the selected value is hoisted to the front first: ordered by
 * count it can land in the overflow, and a filter you cannot see is a filter
 * you cannot undo. When nothing folds, the given order is left alone — the
 * short rows are scales rather than value lists, and hoisting the selection
 * there would print the rating steps as "4.5+, 4.0+".
 */
function FilterRow({ label, chips }: { label: string; chips: Chip[] }) {
  if (chips.length === 0) return null;

  const ordered =
    chips.length <= VISIBLE_VALUES
      ? chips
      : [
          ...chips.filter((chip) => chip.selected),
          ...chips.filter((chip) => !chip.selected),
        ];
  const visible = ordered.slice(0, VISIBLE_VALUES);
  const overflow = ordered.slice(VISIBLE_VALUES);

  return (
    <div className="grid gap-x-6 gap-y-2 border-t border-[var(--rule)] py-3.5 sm:grid-cols-[7.5rem_1fr]">
      <h3 className="label pt-1 text-[var(--muted)]">{label}</h3>
      <div>
        <ChipList chips={visible} />
        {overflow.length > 0 && (
          /*
            `list-none` plus an explicit chevron rather than the native marker.
            The summary is set in the same mono-uppercase `label` as the row
            headings, so with the triangle suppressed — which `inline-block`
            does on its own — it read as a heading rather than a control. The
            underline is permanent for the same reason: nothing else in this
            panel is underlined at rest except a filter that is switched on.
          */
          <details className="group mt-2">
            <summary className="label inline-flex cursor-pointer list-none items-center gap-1.5 text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)] [&::-webkit-details-marker]:hidden">
              {/* A swapped glyph rather than a rotated one: Tailwind v4's
                  `rotate-90` compiles to the standalone `rotate` property here
                  and resolves to 0deg, so the chevron never actually turned.
                  Two glyphs need no transform at all. */}
              <span aria-hidden="true" className="group-open:hidden">
                +
              </span>
              <span aria-hidden="true" className="hidden group-open:inline">
                −
              </span>
              <span className="group-open:hidden">
                Show {overflow.length} more
              </span>
              <span className="hidden group-open:inline">Show fewer</span>
            </summary>
            <div className="mt-2">
              <ChipList chips={overflow} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

/** Turn a group's facet values into chips, each linking to its toggled filter. */
function toChips(
  values: FacetValue[],
  group: FacetGroup,
  query: string,
  filter: BusinessFilter,
  sort: SortKey,
): Chip[] {
  return values.map((value) => ({
    key: value.value,
    label: value.label,
    selected: value.selected,
    count: value.count,
    href: searchHref({
      query,
      filter: toggleFilter(filter, group, value.value),
      sort,
    }),
  }));
}

export function SearchFilters({
  query,
  filter,
  sort,
  facets,
  hasFilters,
}: {
  query: string;
  filter: BusinessFilter;
  sort: SortKey;
  facets: FacetGroups;
  hasFilters: boolean;
}) {
  const chips = (group: FacetGroup) =>
    toChips(facets[group], group, query, filter, sort);

  const sortChips: Chip[] = SORT_KEYS.map((key) => ({
    key,
    label: SORT_LABELS[key],
    selected: sort === key,
    href: searchHref({ query, filter, sort: key }),
  }));

  return (
    <section aria-labelledby="search-filters-heading" className="mt-6">
      {/*
        A real heading, not just an aria-label. /search has no visible <h1> —
        the search box is the page's subject — so the headings here are what a
        screen-reader user navigates by, and a labelled region with nothing
        above it left the whole page as one flat run of <h3>s.
      */}
      <h2 id="search-filters-heading" className="sr-only">
        Filter and sort results
      </h2>
      <FilterRow label="Sort" chips={sortChips} />
      <FilterRow label="Category" chips={chips("category")} />
      <FilterRow label="Area" chips={chips("area")} />
      <FilterRow label="Rating" chips={chips("rating")} />
      <FilterRow label="Reviews" chips={chips("reviews")} />
      <FilterRow label="Details" chips={chips("has")} />
      <FilterRow label="Access" chips={chips("accessibility")} />

      {hasFilters && (
        <div className="border-t border-[var(--rule)] py-3.5">
          <Link
            href={searchHref({ query, sort })}
            prefetch={false}
            className="label text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]"
          >
            Clear all filters
          </Link>
        </div>
      )}
    </section>
  );
}
