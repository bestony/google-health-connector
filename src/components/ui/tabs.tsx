import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

/**
 * shadcn/ui Tabs (base-nova style) over the Base UI primitive.
 *
 * Adapted from the shadcn registry source rather than installed by the CLI:
 * this repo has no shadcn scaffold, and the component needs none of it. The
 * `cva`/`cn` dependencies are dropped — the only class merging that ever
 * happens here is appending a caller's `className`, so a join suffices — and
 * the `variant` prop is a plain union instead of a cva config. The class
 * strings themselves are shadcn's, verbatim; the `data-active` /
 * `data-horizontal` / `data-vertical` variants they rely on are defined in
 * `styles.css`, because Base UI writes orientation as `data-orientation="…"`
 * and Tailwind's built-in `data-*` shorthand only matches attribute presence.
 */

function cx(...classes: Array<string | undefined>): string {
	return classes.filter(Boolean).join(" ");
}

/**
 * Base UI also accepts a `(state) => string` render function for `className`;
 * these wrappers narrow it to a plain string, which is all `cx` can append to
 * (and all shadcn's `cn` really supported either).
 */
type WithClassName<Props> = Omit<Props, "className"> & { className?: string };

function Tabs({
	className,
	orientation = "horizontal",
	...props
}: WithClassName<TabsPrimitive.Root.Props>) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			data-orientation={orientation}
			orientation={orientation}
			className={cx(
				"group/tabs flex gap-2 data-horizontal:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

type TabsListVariant = "default" | "line";

function TabsList({
	className,
	variant = "default",
	...props
}: WithClassName<TabsPrimitive.List.Props> & { variant?: TabsListVariant }) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cx(
				"group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
				variant === "line" ? "gap-1 bg-transparent" : "bg-muted",
				className,
			)}
			{...props}
		/>
	);
}

function TabsTrigger({
	className,
	...props
}: WithClassName<TabsPrimitive.Tab.Props>) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cx(
				"relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				"group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
				"data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
				"after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
				className,
			)}
			{...props}
		/>
	);
}

function TabsContent({
	className,
	...props
}: WithClassName<TabsPrimitive.Panel.Props>) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			className={cx("flex-1 text-sm outline-none", className)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
