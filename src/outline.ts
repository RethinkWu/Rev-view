import { BasesEntry, HeadingCache, ListValue } from 'obsidian';
import type { BoardHost } from './board';

/** The note's headings listed flat on a card, in one collapsible block. */

/** Toggling calls this again, rebuilding only this block rather than the card. */
export function renderOutline(
	containerEl: HTMLElement,
	entry: BasesEntry,
	host: BoardHost,
): void {
	containerEl.empty();

	// Depth 0 means no outline at all, not even the toggle.
	if (host.outlineDepth <= 0) return;

	const all = host.app.metadataCache.getFileCache(entry.file)?.headings;
	if (all === undefined || all.length === 0) return;

	const { headings, baseLevel } = selectHeadings(all, readRootTexts(entry, host));
	if (headings.length === 0) return;

	const { path } = entry.file;
	// Cards the user has toggled keep their own state; the rest follow the option.
	const open = host.outlineOpen.get(path) ?? host.outlineAutoExpand;

	const toggleEl = containerEl.createDiv({ cls: 'refine-outline-toggle' });
	toggleEl.createSpan({ cls: 'refine-outline-caret', text: open ? '▾' : '▸' });
	toggleEl.createSpan({ text: host.outlineLabel });
	toggleEl.addEventListener('click', (evt) => {
		evt.stopPropagation(); // keep the card's open-note click out of this
		host.outlineOpen.set(path, !open);
		renderOutline(containerEl, entry, host);
	});

	if (!open) return;

	const listEl = containerEl.createEl('ul', { cls: 'refine-outline-list' });
	for (const heading of headings) {
		// Level 1 is the outermost heading drawn; CSS turns it into indentation.
		const relative = heading.level - baseLevel;
		if (relative > host.outlineDepth) continue;

		const itemEl = listEl.createEl('li', { cls: 'refine-outline-item' });
		itemEl.style.setProperty('--refine-outline-level', String(relative));

		itemEl
			.createSpan({ cls: 'refine-outline-text', text: heading.heading })
			.addEventListener('click', (evt) => {
				evt.stopPropagation();
				void host.app.workspace.openLinkText(
					`${path}#${heading.heading}`,
					'',
					evt.ctrlKey || evt.metaKey,
				);
			});
	}
}

/**
 * Heading texts to keep, evaluated from the chosen formula property on this
 * note, so each note can name its own. A list property is the normal case; a
 * single string works too. Empty means "no filtering".
 */
function readRootTexts(entry: BasesEntry, host: BoardHost): string[] {
	const source = host.outlineSectionsId;
	if (source === null) return [];

	const value = entry.getValue(source);
	if (value === null || !value.isTruthy()) return [];

	if (value instanceof ListValue) {
		const texts: string[] = [];
		for (let index = 0; index < value.length(); index++) {
			const text = value.get(index).toString().trim();
			if (text !== '') texts.push(text);
		}
		return texts;
	}

	const text = value.toString().trim();
	return text === '' ? [] : [text];
}

/**
 * Picks the range to render.
 *
 * No root: the whole note, and heading levels are used as they are, so a
 * top-level heading sits at depth 1.
 *
 * With roots: every heading whose text is one of them, each followed by its
 * subtree — everything down to the next heading at or above its own level — in
 * document order, so several sections can be stitched together with the
 * headings in between left out. The shallowest match becomes depth 1.
 * No match: nothing renders.
 */
function selectHeadings(
	all: readonly HeadingCache[],
	roots: readonly string[],
): { headings: readonly HeadingCache[]; baseLevel: number } {
	if (roots.length === 0) return { headings: all, baseLevel: 0 };

	const wanted = new Set(roots);
	const picked: HeadingCache[] = [];
	let shallowest = Number.POSITIVE_INFINITY;

	for (let i = 0; i < all.length; i++) {
		if (!wanted.has(all[i].heading.trim())) continue;

		const level = all[i].level;
		shallowest = Math.min(shallowest, level);
		picked.push(all[i]);

		// Its subtree runs until a heading at or above its level, which may
		// itself be another match — hence resuming the outer loop from there.
		let next = i + 1;
		for (; next < all.length; next++) {
			if (all[next].level <= level) break;
			picked.push(all[next]);
		}
		i = next - 1;
	}

	if (picked.length === 0) return { headings: [], baseLevel: 0 };

	// Off by one, so that the outermost heading lands on depth 1.
	return { headings: picked, baseLevel: shallowest - 1 };
}
