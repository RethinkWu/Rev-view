import {
	App,
	BasesEntry,
	BasesPropertyId,
	BasesViewConfig,
	HoverParent,
} from 'obsidian';
import { t, type MessageKey } from './i18n';
import { renderOutline } from './outline';

/** Renders entries as nested boards, splitting them by one property per level. */

/** Board label when the group value is empty. */
const EMPTY_GROUP_LABEL_KEY: MessageKey = 'ungroup';

/** What the renderer needs from the view. BasesView already matches this shape. */
export interface BoardHost extends HoverParent {
	app: App;
	config: BasesViewConfig;
	/** View type id — also the source id registered with registerHoverLinkSource. */
	type: string;
	outlineDepth: number;
	outlineAutoExpand: boolean;
	/** Formula property holding the outline root heading; null = the whole note. */
	outlineRootId: BasesPropertyId | null;
	outlineLabel: string;
	/** Per-note outline open state, held by the view so it survives a rebuild. */
	outlineOpen: Map<string, boolean>;
}

/** Entries plus boards beyond this are not drawn at all. */
const RENDER_BUDGET = 2000;

/**
 * Renders entries as nested boards under containerEl, outermost property first.
 * An empty property list means one flat board. Entry order is never changed.
 */
export function renderBoard(
	containerEl: HTMLElement,
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	host: BoardHost,
): void {
	// Counted first, without touching the DOM.
	const boards = countBoards(entries, properties, 0, RENDER_BUDGET);
	if (entries.length + boards > RENDER_BUDGET) {
		containerEl.createDiv({
			cls: 'refine-warning',
			text: t('tooMuchToDraw', {
				entries: String(entries.length),
				boards: String(boards),
				limit: String(RENDER_BUDGET),
			}),
		});
		return;
	}

	if (properties.length === 0) {
		renderFlat(containerEl, entries, host);
		return;
	}
	renderLevel(containerEl, entries, properties, 0, host);
}

/** One level: split by properties[depth], then recurse or draw cards. */
function renderLevel(
	parentEl: HTMLElement,
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	depth: number,
	host: BoardHost,
): void {
	const property = properties[depth];
	if (property === undefined) return;

	const columnsEl = parentEl.createDiv('refine-columns');
	for (const [label, bucket] of bucketEntries(entries, property)) {
		const columnEl = columnsEl.createDiv('refine-column');
		columnEl.createEl('h3', { text: label ?? t(EMPTY_GROUP_LABEL_KEY) });

		if (depth + 1 < properties.length) {
			// Lets CSS size this column to the row of sub-boards inside it.
			columnEl.addClass('refine-column--parent');
			renderLevel(columnEl, bucket, properties, depth + 1, host);
		} else {
			renderCards(columnEl, bucket, host);
		}
	}
}

/** No nesting: every entry in a single board. */
function renderFlat(
	parentEl: HTMLElement,
	entries: BasesEntry[],
	host: BoardHost,
): void {
	const columnsEl = parentEl.createDiv('refine-columns');
	const columnEl = columnsEl.createDiv('refine-column');
	columnEl.createEl('h3', { text: t(EMPTY_GROUP_LABEL_KEY) });
	renderCards(columnEl, entries, host);
}

function renderCards(
	columnEl: HTMLElement,
	entries: BasesEntry[],
	host: BoardHost,
): void {
	const cardListEl = columnEl.createDiv('refine-card-list');
	for (const entry of entries) {
		renderCard(cardListEl.createDiv('refine-card'), entry, host);
	}
}

/** One card, laid out like the built-in Bases card view. */
function renderCard(cardEl: HTMLElement, entry: BasesEntry, host: BoardHost): void {
	// The whole card opens the note; Ctrl/Cmd opens a new tab.
	cardEl.addEventListener('click', (evt) => {
		void host.app.workspace
			.getLeaf(evt.ctrlKey || evt.metaKey)
			.openFile(entry.file);
	});

	// Page preview draws the popover; we only fire the event.
	cardEl.addEventListener('mouseover', (evt) => {
		// Moving within the card keeps relatedTarget inside it.
		if (evt.relatedTarget instanceof Node && cardEl.contains(evt.relatedTarget)) {
			return;
		}
		host.app.workspace.trigger('hover-link', {
			event: evt,
			source: host.type,
			hoverParent: host,
			targetEl: cardEl,
			linktext: entry.file.path,
			sourcePath: '',
		});
	});

	const [titleId, ...propertyIds] = host.config.getOrder();

	renderTitle(cardEl, entry, titleId, host);

	for (const propertyId of propertyIds) {
		const value = entry.getValue(propertyId);
		if (value === null || !value.isTruthy()) continue;

		const rowEl = cardEl.createDiv('refine-card-property');
		rowEl.createDiv({
			cls: 'refine-card-property-name',
			text: host.config.getDisplayName(propertyId),
		});
		value.renderTo(
			rowEl.createDiv('refine-card-property-value'),
			host.app.renderContext,
		);
	}

	renderOutline(cardEl.createDiv('refine-card-outline'), entry, host);
}

/** Title slot: the value alone, no display name. */
function renderTitle(
	cardEl: HTMLElement,
	entry: BasesEntry,
	titleId: BasesPropertyId | undefined,
	host: BoardHost,
): void {
	if (titleId === undefined) return;

	const value = entry.getValue(titleId);
	if (value === null || !value.isTruthy()) return;

	value.renderTo(cardEl.createDiv('refine-card-title'), host.app.renderContext);
}

/**
 * Buckets by one property's value, keeping first-seen order (which is Bases'
 * own sort). Missing and empty values share the null bucket.
 */
function bucketEntries(
	entries: BasesEntry[],
	property: BasesPropertyId,
): Map<string | null, BasesEntry[]> {
	const buckets = new Map<string | null, BasesEntry[]>();

	for (const entry of entries) {
		const value = entry.getValue(property);
		const text = value === null ? '' : value.toString();
		const key = text === '' ? null : text;

		const bucket = buckets.get(key);
		if (bucket === undefined) buckets.set(key, [entry]);
		else bucket.push(entry);
	}
	return buckets;
}

/** How many boards renderLevel would draw, counted without touching the DOM. */
function countBoards(
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	depth: number,
	budget: number,
): number {
	if (entries.length > budget) return budget + 1;

	const property = properties[depth];
	if (property === undefined) return 1; // the one board of the flat case

	let total = 0;
	for (const [, bucket] of bucketEntries(entries, property)) {
		total += 1;
		if (depth + 1 < properties.length) {
			total += countBoards(bucket, properties, depth + 1, budget);
		}
		if (total > budget) return total;
	}
	return total;
}
