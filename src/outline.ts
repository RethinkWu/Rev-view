import { BasesEntry, HeadingCache } from 'obsidian';
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

	const { headings, baseLevel } = selectHeadings(all, readRootText(entry, host));
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
		// Relative to the root; without one baseLevel is 0.
		const relative = heading.level - baseLevel;
		if (relative > host.outlineDepth) continue;

		const itemEl = listEl.createEl('li', { cls: 'refine-outline-item' });
		// CSS turns the level into indentation.
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
 * Root heading text, evaluated from the chosen formula property on this note,
 * so each note can have its own root. Unset or empty means no filtering.
 */
function readRootText(entry: BasesEntry, host: BoardHost): string {
	const source = host.outlineRootId;
	if (source === null) return '';

	const value = entry.getValue(source);
	if (value === null || !value.isTruthy()) return '';
	return value.toString().trim();
}

/**
 * Picks the range to render. With no root that is the whole note; with one it
 * is the subtree under the matching heading, the root excluded. No match
 * renders nothing.
 */
function selectHeadings(
	all: readonly HeadingCache[],
	rootText: string,
): { headings: readonly HeadingCache[]; baseLevel: number } {
	const wanted = rootText.trim();
	if (wanted === '') return { headings: all, baseLevel: 0 };

	const start = all.findIndex((heading) => heading.heading.trim() === wanted);
	if (start === -1) return { headings: [], baseLevel: 0 };

	const baseLevel = all[start].level;
	const subtree: HeadingCache[] = [];
	for (let i = start + 1; i < all.length; i++) {
		// Nothing shallower than the root belongs to this subtree.
		if (all[i].level <= baseLevel) break;
		subtree.push(all[i]);
	}
	return { headings: subtree, baseLevel };
}
