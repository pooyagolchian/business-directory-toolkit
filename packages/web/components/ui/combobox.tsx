"use client";

/*
 * shadcn/ui Combobox, vendored and trimmed — see docs/adr/0004-design-system.md.
 *
 * Kept from upstream: the Base UI primitives, the data-slot attributes, and the
 * part names, so `npx shadcn diff combobox` still reads.
 *
 * Trimmed, and why:
 *  - Upstream's `ComboboxInput` composes InputGroup + Button to render the
 *    input AS the trigger. This app wants the opposite arrangement — a button
 *    that reads like the rest of the fields, with the search box inside the
 *    popup — so that composition is replaced by `ComboboxSearch` and the
 *    `button`, `input`, `textarea` and `input-group` files it dragged in were
 *    deleted rather than left as dead code. They also depend on
 *    class-variance-authority, which nothing else here needs.
 *  - Chips (the multi-select arrangement) removed. These filters are single
 *    select; the parts can come back from the registry the day they are not.
 *  - Radii to `rounded-none`, `dark:` variants dropped, trigger padding on this
 *    repo's field metrics — the same trim the Select got.
 *
 * Colours are NOT trimmed: `bg-popover`, `border-input` and friends resolve
 * through the token bridge in globals.css.
 */

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Combobox = ComboboxPrimitive.Root;

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

/** Deliberately identical to the Select trigger: they sit side by side. */
function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-none border border-input bg-[var(--field-bg)] px-3.5 py-2.5 text-left text-sm whitespace-nowrap transition-colors select-none hover:border-[var(--field-border-hover)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ComboboxPrimitive.Icon
        render={
          <ChevronDownIcon
            strokeWidth={1.5}
            className="pointer-events-none h-4.5 w-4.5 shrink-0 text-muted-foreground transition-colors"
          />
        }
      />
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "group/combobox-content relative flex max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) flex-col overflow-hidden rounded-none border border-border bg-popover text-popover-foreground shadow-[var(--surface-shadow)] duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

/**
 * The search field, inside the popup.
 *
 * Base UI moves focus here when the popup opens and keeps the highlighted item
 * in the list, so typing filters and the arrow keys still walk the results —
 * the input never has to hand focus back.
 */
function ComboboxSearch({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-3.5 py-2.5">
      <SearchIcon
        aria-hidden="true"
        strokeWidth={1.5}
        className="h-4.5 w-4.5 shrink-0 text-muted-foreground"
      />
      <ComboboxPrimitive.Input
        data-slot="combobox-search"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "scroll-py-1 overflow-y-auto overscroll-contain",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-none py-2 pr-8 pl-3.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-3 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return (
    <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "hidden px-3.5 py-6 text-center text-sm text-muted-foreground group-data-empty/combobox-content:block",
        className,
      )}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
  ComboboxValue,
};
