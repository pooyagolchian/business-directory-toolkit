const MILESTONES = [
  {
    tag: "v0.1",
    title: "The data pipeline",
    body: "Crawl, deduplicate, and categorise ~10,000 Dubai businesses from the Maps engine.",
    state: "In progress",
  },
  {
    tag: "v0.2",
    title: "Search",
    body: "Phone lookup over +971 numbers in E.164, search-as-you-type, measured latency.",
    state: "Planned",
  },
  {
    tag: "v1.0",
    title: "The payoff",
    body: "Programmatic SEO toward 10,000 pages, a Search Console retro, and the full AWS bill.",
    state: "Planned",
  },
] as const;

const FINDINGS = [
  { value: "~200", label: "result ceiling per query" },
  { value: "0", label: "overlap between tiles" },
  { value: "17.5", label: "unique results per request" },
  { value: "9", label: "categories on one business" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24 sm:py-32">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
        Building in public
      </p>

      <h1 className="mt-6 font-[family-name:var(--font-display)] text-5xl leading-[1.05] tracking-tight sm:text-7xl">
        Directory
        <br />
        from Scratch
      </h1>

      <p className="mt-8 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
        An open-source Dubai business search engine, built on SearchApi&rsquo;s
        Google Maps engine — from the first paged request to a live product,
        with the AWS bill published at the end.
      </p>

      <dl className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-sm bg-[var(--rule)] sm:grid-cols-4">
        {FINDINGS.map((f) => (
          <div key={f.label} className="bg-[var(--bg)] p-5">
            <dt className="tabular text-2xl">{f.value}</dt>
            <dd className="mt-1 text-xs leading-snug text-[var(--muted)]">
              {f.label}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Measured against the live engine before any code was written.
      </p>

      <ol className="mt-20 space-y-px">
        {MILESTONES.map((m) => (
          <li
            key={m.tag}
            className="flex gap-6 border-t border-[var(--rule)] py-6 last:border-b"
          >
            <span className="tabular w-12 shrink-0 text-sm text-[var(--muted)]">
              {m.tag}
            </span>
            <div className="min-w-0">
              <h2 className="font-[family-name:var(--font-display)] text-xl">
                {m.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
                {m.body}
              </p>
            </div>
            <span className="ml-auto shrink-0 self-start font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
              {m.state}
            </span>
          </li>
        ))}
      </ol>

      <footer className="mt-20 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--rule)] pt-6 text-sm">
        <a
          className="underline underline-offset-4 hover:text-[var(--muted)]"
          href="https://github.com/pooyagolchian/directory-from-scratch"
        >
          Source
        </a>
        <a
          className="underline underline-offset-4 hover:text-[var(--muted)]"
          href="https://pooyagolchian.com"
        >
          Write-ups
        </a>
        <span className="ml-auto text-[var(--muted)]">
          Business listings only. Takedown requests honoured.
        </span>
      </footer>
    </main>
  );
}
