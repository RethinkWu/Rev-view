import {
	App,
	BasesEntry,
	BasesPropertyId,
	BasesViewConfig,
	HoverParent,
} from 'obsidian';
import { t, type MessageKey } from './i18n';
import { renderOutline } from './outline';

/**
 * Turns a list of entries into nested boards, splitting them by one property
 * per level. This file only knows how to draw; where the property list comes
 * from is the view's business, so changing that source never touches it.
 */

/**
 * Label for a board whose group value is empty — a missing property and an
 * empty string both count. Stored as a key, not text: initLanguage() has not
 * run yet when this module loads.
 */
const EMPTY_GROUP_LABEL_KEY: MessageKey = 'ungroup';

/**
 * What the renderer needs from the view. BasesView already matches this shape,
 * so callers can just pass `this`.
 */
export interface BoardHost extends HoverParent {
	app: App;
	config: BasesViewConfig;
	/** View type id — also the source id registered with registerHoverLinkSource. */
	type: string;
	/** Deepest heading level to draw in card outlines. 0 = none. */
	outlineDepth: number;
	outlineAutoExpand: boolean;
	/** Formula property holding the outline root heading; null = the whole note. */
	outlineRootId: BasesPropertyId | null;
	outlineLabel: string;
	/** Per-note outline open state, held by the view so it survives a rebuild. */
	outlineOpen: Map<string, boolean>;
}

/**
 * Draw at most this many entries plus boards. A base with no filter (which the
 * official guide warns about) times a few nesting levels can otherwise freeze
 * the UI, and every rebuild is a full teardown.
 */
const RENDER_BUDGET = 2000;

/**
 * Renders entries as nested boards under containerEl.
 *
 * `properties` defines the levels, outermost first; an empty list means no
 * nesting and everything lands in one board. Entry order is preserved — Bases
 * already sorted them — and is never changed here.
 */
export function renderBoard(
	containerEl: HTMLElement,
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	host: BoardHost,
): void {
	// Count first, without touching the DOM. Over budget, draw nothing at all.
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

/**
 * Draws one level: entries split into boards by properties[depth]. Recurses if
 * another level follows, otherwise lays the entries out as cards.
 */
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
			// Marks a column holding sub-boards, so CSS can size it to them.
			columnEl.addClass('refine-column--parent');
			renderLevel(columnEl, bucket, properties, depth + 1, host);
		} else {
			renderCards(columnEl, bucket, host);
		}
	}
}

/** No nesting: a single board holding every entry. */
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

/**
 * One card, laid out like the built-in Bases card view: the first property in
 * the Properties menu becomes a bare title, the rest get a block each with the
 * display name above the value. Order and display names come from that menu.
 */
function renderCard(cardEl: HTMLElement, entry: BasesEntry, host: BoardHost): void {
	// The whole card is clickable. Ctrl/Cmd opens it in a new tab.
	cardEl.addEventListener('click', (evt) => {
		void host.app.workspace
			.getLeaf(evt.ctrlKey || evt.metaKey)
			.openFile(entry.file);
	});

	// Hover preview. The popover itself is the Page preview core plugin's job;
	// we only fire the event.
	cardEl.addEventListener('mouseover', (evt) => {
		// Moving inside the card keeps relatedTarget within it — do not refire.
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

	// Outline at the bottom. Draws nothing when the note has no headings.
	renderOutline(cardEl.createDiv('refine-card-outline'), entry, host);
}

/** Title slot: the value alone, no display name. No title if the menu is empty. */
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
 * Buckets entries by one property's value, keeping first-seen order (which is
 * Bases' own sort). A missing or empty value goes to the `null` bucket.
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

/**
 * Counts how many boards would be drawn, mirroring renderLevel's structure
 * without building any DOM. Grouping is cheap; the DOM is not. Gives up as
 * soon as the budget is passed.
 */
function countBoards(
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	depth: number,
	budget: number,
): number {
	// More entries than the whole budget already — no point counting further.
	if (entries.length > budget) return budget + 1;

	const property = properties[depth];
	if (property === undefined) return 1; // the single board of the flat case

	let total = 0;
	for (const [, bucket] of bucketEntries(entries, property)) {
		total += 1;
		if (depth + 1 < properties.length) {
			total += countBoards(bucket, properties, depth + 1, budget);
		}
		if (total > budget) return total; // already over; the exact number is moot
	}
	return total;
}
