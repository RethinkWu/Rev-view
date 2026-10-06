import {
	BasesPropertyId,
	BasesView,
	HoverParent,
	HoverPopover,
	Plugin,
	QueryController,
} from 'obsidian';
import { renderBoard } from './board';
import { initLanguage, t } from './i18n';

export const REFINE_VIEW_TYPE = 'refine-view';

// Option keys. The nesting levels are not one of them — they come from the
// first N entries of the Bases sort list.
const NEST_DEPTH_KEY = 'nest-depth';
/** Deepest heading level to draw. 0 = no outline at all. */
const HEADING_DEPTH_KEY = 'heading-depth';
/** Formula property holding the outline's root heading. Unset = the whole note. */
const OUTLINE_ROOT_KEY = 'outline-root';
const OUTLINE_EXPANDED_KEY = 'outline-expanded';
const OUTLINE_LABEL_KEY = 'outline-label';
const COLUMN_WIDTH_KEY = 'column-width';
/** Past this the card list scrolls instead of stretching the column. */
const COLUMN_HEIGHT_KEY = 'column-height';

/** Fallback for a slider with no value yet. Keep in sync with the CSS defaults. */
const DEFAULT_COLUMN_WIDTH = 340;
/** 780px fits about ten title-only cards — tuned by hand. */
const DEFAULT_COLUMN_HEIGHT = 780;

/** Bases calls us on any vault change, so wait a beat and coalesce the bursts. */
const RENDER_DELAY_MS = 100;

export default class RevViewPlugin extends Plugin {
	async onload() {
		initLanguage(); // every t() below depends on this

		const viewName = t('viewName');

		// Page preview only previews hover-links from sources registered here.
		// `display` shows up in its settings and should be the plugin's name.
		this.registerHoverLinkSource(REFINE_VIEW_TYPE, {
			display: this.manifest.name,
			// Require Ctrl/Cmd by default, as with regular links.
			defaultMod: true,
		});

		this.registerBasesView(REFINE_VIEW_TYPE, {
			name: viewName,
			icon: 'lucide-notebook-pen',
			factory: (controller, containerEl) => {
				return new RefineBasesView(controller, containerEl);
			},
			options: () => [
				{
					// Nesting follows the Bases sort list, so every level is an
					// official property picker and no string matching is needed.
					// The rest of the list stays pure sorting: Bases already
					// ordered the data and we never re-sort, so it only shows in
					// the card order at the innermost level.
					type: 'text',
					key: NEST_DEPTH_KEY,
					displayName: t('nestDepth'),
					placeholder: t('numberPlaceholder'),
				},
				{
					// A formula property whose value is the root heading's text,
					// so the root can differ per note instead of being typed in.
					// Unset = every heading in the note.
					type: 'property',
					key: OUTLINE_ROOT_KEY,
					displayName: t('outlineRoot'),
					filter: (propertyId) => propertyId.startsWith('formula.'),
				},
				{
					// Placeholder rather than default: an empty field keeps
					// following the UI language instead of being frozen into
					// the .base file.
					type: 'text',
					key: OUTLINE_LABEL_KEY,
					displayName: t('outlineLabel'),
					placeholder: t('outline'),
				},
				{
					// Expand outlines by default. Per-card open state is still
					// remembered once the user toggles one.
					type: 'toggle',
					key: OUTLINE_EXPANDED_KEY,
					displayName: t('autoExpandOutline'),
					default: false,
				},
				{
					// Nested levels shrink proportionally, so this is the only
					// width to configure.
					type: 'slider',
					key: COLUMN_WIDTH_KEY,
					displayName: t('columnWidth'),
					min: 200,
					max: 600,
					step: 20,
					default: DEFAULT_COLUMN_WIDTH,
				},
				{
					type: 'slider',
					key: COLUMN_HEIGHT_KEY,
					displayName: t('columnHeight'),
					min: 200,
					max: 1600,
					step: 20,
					default: DEFAULT_COLUMN_HEIGHT,
				},
				{
					// 0 hides the outline entirely.
					type: 'slider',
					key: HEADING_DEPTH_KEY,
					displayName: t('headingDepth'),
					min: 0,
					max: 6,
					step: 1,
					default: 1,
				},
			],
		});
	}
}

export class RefineBasesView extends BasesView implements HoverParent {
	readonly type = REFINE_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	// All of these are refreshed from the options at the start of every render.
	outlineDepth = 1;
	outlineAutoExpand = false;
	outlineRootId: BasesPropertyId | null = null;
	outlineLabel = '';
	columnWidth = DEFAULT_COLUMN_WIDTH;
	columnHeight = DEFAULT_COLUMN_HEIGHT;

	/**
	 * Per-note outline open state. Lives on the instance so it survives a full
	 * rebuild, and so split panes do not share it.
	 */
	readonly outlineOpen = new Map<string, boolean>();

	private containerEl: HTMLElement;
	private renderTimer: number | null = null;
	/** Fingerprint of the last render. Unchanged means the rebuild is skipped. */
	private lastSignature = '';

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv('refine-container');

		this.register(() => {
			if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		});
	}

	/** Bases calls this on any vault change; debounce so a burst rebuilds once. */
	public onDataUpdated(): void {
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.render();
		}, RENDER_DELAY_MS);
	}

	private render(): void {
		this.outlineDepth = this.readOutlineDepth();
		this.outlineAutoExpand = this.config.get(OUTLINE_EXPANDED_KEY) === true;
		this.outlineRootId = this.config.getAsPropertyId(OUTLINE_ROOT_KEY);
		const label: unknown = this.config.get(OUTLINE_LABEL_KEY);
		this.outlineLabel =
			typeof label === 'string' && label.trim() !== '' ? label : t('outline');

		const width: unknown = this.config.get(COLUMN_WIDTH_KEY);
		this.columnWidth =
			typeof width === 'number' && width > 0 ? width : DEFAULT_COLUMN_WIDTH;

		const height: unknown = this.config.get(COLUMN_HEIGHT_KEY);
		this.columnHeight =
			typeof height === 'number' && height > 0 ? height : DEFAULT_COLUMN_HEIGHT;

		const { properties, badDepth } = this.readNestConfig();

		// Bases calls us on every vault change — including edits to notes that
		// are not in this base — so skip the whole rebuild when nothing that
		// affects the output has changed.
		const signature = this.renderSignature(properties, badDepth);
		if (signature === this.lastSignature) return;
		this.lastSignature = signature;

		// Width and height travel as CSS variables, inherited by every board.
		this.containerEl.style.setProperty(
			'--refine-column-width',
			`${String(this.columnWidth)}px`,
		);
		this.containerEl.style.setProperty(
			'--refine-column-max-height',
			`${String(this.columnHeight)}px`,
		);

		// Build off-screen, then swap in one go — no clear-then-grow flicker.
		const staging = createDiv();

		if (badDepth !== null) {
			staging.createDiv({
				cls: 'refine-warning',
				text: t('badNestDepth', { value: badDepth }),
			});
		}

		renderBoard(staging, this.data.data, properties, this);

		// append() detaches from staging, so the loop converges.
		this.containerEl.empty();
		while (staging.firstChild !== null) {
			this.containerEl.append(staging.firstChild);
		}
	}

	/**
	 * Fingerprint of everything the render depends on: the entries (path, mtime
	 * and every property we draw), their order, and all options.
	 */
	private renderSignature(
		properties: BasesPropertyId[],
		badDepth: string | null,
	): string {
		const order = this.config.getOrder();
		const parts: string[] = [
			properties.join(','),
			// Display names too: renaming a property must relabel the cards.
			order
				.map((id) => `${id}=${this.config.getDisplayName(id)}`)
				.join(','),
			this.config
				.getSort()
				.map((entry) => `${entry.property}:${entry.direction}`)
				.join(','),
			badDepth ?? '',
			`${String(this.outlineDepth)}|${String(this.outlineAutoExpand)}|${this.outlineRootId ?? ''}|${this.outlineLabel}|${String(this.columnWidth)}|${String(this.columnHeight)}`,
		];

		// Property values count too: a formula can reference another file, whose
		// edits would not show up in this one's mtime.
		const valueProperties = [
			...new Set([
				...properties,
				...order,
				...(this.outlineRootId === null ? [] : [this.outlineRootId]),
			]),
		];

		for (const entry of this.data.data) {
			parts.push(`${entry.file.path}@${String(entry.file.stat.mtime)}`);
			for (const propertyId of valueProperties) {
				const value = entry.getValue(propertyId);
				parts.push(value === null ? '' : value.toString());
			}
		}
		return parts.join('\u0000');
	}

	/** Deepest heading level to draw. 0 = no outline; anything else defaults to 1. */
	private readOutlineDepth(): number {
		const depth = Number(this.config.get(HEADING_DEPTH_KEY));
		return Number.isInteger(depth) && depth >= 0 ? depth : 1;
	}

	/**
	 * Nesting levels = the first N entries of the sort list. An empty field means
	 * all of them; anything that is not a non-negative integer is ignored and
	 * returned so the view can warn about it.
	 */
	private readNestConfig(): {
		properties: BasesPropertyId[];
		badDepth: string | null;
	} {
		const sorted = this.config.getSort().map((entry) => entry.property);
		const raw: unknown = this.config.get(NEST_DEPTH_KEY);

		if (typeof raw !== 'string' || raw.trim() === '') {
			return { properties: sorted, badDepth: null };
		}

		const text = raw.trim();
		const depth = Number(text);
		if (!Number.isInteger(depth) || depth < 0) {
			return { properties: sorted, badDepth: text };
		}
		return { properties: sorted.slice(0, depth), badDepth: null };
	}
}
