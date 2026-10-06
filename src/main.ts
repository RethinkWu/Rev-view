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

const NEST_DEPTH_KEY = 'nest-depth';
const HEADING_DEPTH_KEY = 'heading-depth';
const OUTLINE_SECTIONS_KEY = 'outline-sections';
const OUTLINE_EXPANDED_KEY = 'outline-expanded';
const OUTLINE_LABEL_KEY = 'outline-label';
const COLUMN_WIDTH_KEY = 'column-width';
const COLUMN_HEIGHT_KEY = 'column-height';

/** Fallback for a slider with no value. Keep in sync with the CSS defaults. */
const DEFAULT_COLUMN_WIDTH = 340;
const DEFAULT_COLUMN_HEIGHT = 780;
/** 0 means a new base starts with no outline drawn. */
const DEFAULT_HEADING_DEPTH = 0;

/** Bases reports every vault change, so coalesce the bursts. */
const RENDER_DELAY_MS = 100;

export default class RevViewPlugin extends Plugin {
	async onload() {
		initLanguage();

		const viewName = t('viewName');

		// Makes the Page preview core plugin handle card previews.
		this.registerHoverLinkSource(REFINE_VIEW_TYPE, {
			display: this.manifest.name,
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
					// Levels are the leading entries of the Bases sort list, so
					// every one is an official property picker.
					type: 'text',
					key: NEST_DEPTH_KEY,
					displayName: t('nestDepth'),
					placeholder: t('numberPlaceholder'),
				},
				{
					// A formula whose value is the root heading's text, so the
					// root can differ per note. Unset = every heading.
					type: 'property',
					key: OUTLINE_SECTIONS_KEY,
					displayName: t('outlineSections'),
					filter: (propertyId) => propertyId.startsWith('formula.'),
				},
				{
					// Placeholder, not default: an empty field keeps following
					// the UI language instead of being frozen into the .base.
					type: 'text',
					key: OUTLINE_LABEL_KEY,
					displayName: t('outlineLabel'),
					placeholder: t('outline'),
				},
				{
					type: 'toggle',
					key: OUTLINE_EXPANDED_KEY,
					displayName: t('autoExpandOutline'),
					default: false,
				},
				{
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
					default: DEFAULT_HEADING_DEPTH,
				},
			],
		});
	}
}

export class RefineBasesView extends BasesView implements HoverParent {
	readonly type = REFINE_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	// All refreshed from the options at the start of every render.
	outlineDepth = DEFAULT_HEADING_DEPTH;
	outlineAutoExpand = false;
	outlineSectionsId: BasesPropertyId | null = null;
	outlineLabel = '';
	columnWidth = DEFAULT_COLUMN_WIDTH;
	columnHeight = DEFAULT_COLUMN_HEIGHT;

	/** Per-note outline open state. On the instance so split panes do not share it. */
	readonly outlineOpen = new Map<string, boolean>();

	private containerEl: HTMLElement;
	private renderTimer: number | null = null;
	/** Fingerprint of the last render; an unchanged one skips the rebuild. */
	private lastSignature = '';

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv('refine-container');

		this.register(() => {
			if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		});
	}

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
		this.outlineSectionsId = this.config.getAsPropertyId(OUTLINE_SECTIONS_KEY);
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

		// Bases fires for any vault change, including notes outside this base,
		// so skip when nothing the render depends on has changed.
		const signature = this.renderSignature(properties, badDepth);
		if (signature === this.lastSignature) return;
		this.lastSignature = signature;

		// Inherited as CSS variables by every board.
		this.containerEl.style.setProperty(
			'--refine-column-width',
			`${String(this.columnWidth)}px`,
		);
		this.containerEl.style.setProperty(
			'--refine-column-max-height',
			`${String(this.columnHeight)}px`,
		);

		// Built off-screen, then swapped in whole — no clear-then-grow flicker.
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

	/** Fingerprint of everything the render depends on. */
	private renderSignature(
		properties: BasesPropertyId[],
		badDepth: string | null,
	): string {
		const order = this.config.getOrder();
		const parts: string[] = [
			properties.join(','),
			// Display names too, or renaming a property would not relabel the cards.
			order
				.map((id) => `${id}=${this.config.getDisplayName(id)}`)
				.join(','),
			this.config
				.getSort()
				.map((entry) => `${entry.property}:${entry.direction}`)
				.join(','),
			badDepth ?? '',
			`${String(this.outlineDepth)}|${String(this.outlineAutoExpand)}|${this.outlineSectionsId ?? ''}|${this.outlineLabel}|${String(this.columnWidth)}|${String(this.columnHeight)}`,
		];

		// A formula can reference another file, whose edits never touch this
		// note's mtime, so the values themselves have to be part of the hash.
		const valueProperties = [
			...new Set([
				...properties,
				...order,
				...(this.outlineSectionsId === null ? [] : [this.outlineSectionsId]),
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

	/** Deepest heading level to draw. 0 = none; anything unreadable uses the default. */
	private readOutlineDepth(): number {
		const depth = Number(this.config.get(HEADING_DEPTH_KEY));
		return Number.isInteger(depth) && depth >= 0 ? depth : DEFAULT_HEADING_DEPTH;
	}

	/** Nesting levels = the first N sort entries. A non-integer is reported back so the view can warn. */
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
