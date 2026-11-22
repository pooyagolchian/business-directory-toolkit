/**
 * A static list of short labels: a listing's accessibility features, payment
 * and service options, Google's own categories.
 *
 * Plain muted text with a middle-dot separator, deliberately NOT bordered
 * chips. A bordered box is how this design marks a control — the search field,
 * the facet filters — and none of these labels does anything when pressed, so
 * the box promised an interaction that was not there. The separator is the
 * same `·` the category · area line under every title already uses.
 *
 * Each separator is attached to the item BEFORE it with a no-break space, so
 * when the list wraps a line can end on `·` but never begin with one. It is
 * aria-hidden: the list semantics already tell a screen reader where items
 * end, and "dot" between each would be noise.
 */
export function TagList({
  items,
  className,
}: {
  items: readonly string[];
  className?: string;
}) {
  return (
    <ul className={`label text-[var(--muted)] ${className ?? ""}`}>
      {items.map((item, i) => (
        <li key={item} className="inline">
          {item}
          {i < items.length - 1 && <span aria-hidden="true">{" · "}</span>}
        </li>
      ))}
    </ul>
  );
}
