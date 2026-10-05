import { BasesEntry, HeadingCache } from 'obsidian';
import type { BoardHost } from './board';

/**
 * 卡片上的大纲：把笔记的标题按层级平铺出来，整块可折起。
 *
 * 数据源只有一个 —— `metadataCache.getFileCache(file).headings`。
 * 它是同步的缓存查找，不读文件也不解析，取一次基本免费；
 * 真正贵的是往 DOM 里画，所以默认整块收起，按需展开。
 */

/**
 * 画整块大纲，挂在 containerEl 下。
 * 折叠时重新调用它 —— 只重建这一小块，不动整张卡片。
 */
export function renderOutline(
	containerEl: HTMLElement,
	entry: BasesEntry,
	host: BoardHost,
): void {
	containerEl.empty();

	// 层数设成 0 就是不渲染大纲，连折叠开关都不出
	if (host.outlineDepth <= 0) return;

	const all = host.app.metadataCache.getFileCache(entry.file)?.headings;
	if (all === undefined || all.length === 0) return;

	const { headings, baseLevel } = selectHeadings(all, readRootText(entry, host));
	if (headings.length === 0) return;

	const { path } = entry.file;
	// 没被手动开合过的走「默认展开」这个选项
	const open = host.outlineOpen.get(path) ?? host.outlineAutoExpand;

	const toggleEl = containerEl.createDiv({ cls: 'refine-outline-toggle' });
	toggleEl.createSpan({ cls: 'refine-outline-caret', text: open ? '▾' : '▸' });
	toggleEl.createSpan({ text: host.outlineLabel });
	toggleEl.addEventListener('click', (evt) => {
		evt.stopPropagation(); // 别让卡片的「整卡跳转」抢走这次点击
		host.outlineOpen.set(path, !open);
		renderOutline(containerEl, entry, host);
	});

	if (!open) return;

	const listEl = containerEl.createEl('ul', { cls: 'refine-outline-list' });
	for (const heading of headings) {
		// 层级按「相对根往下第几级」算：没有根时 baseLevel 是 0，就等于绝对层级
		const relative = heading.level - baseLevel;
		if (relative > host.outlineDepth) continue;

		const itemEl = listEl.createEl('li', { cls: 'refine-outline-item' });
		// 缩进交给 CSS 算，这里只把层级递过去
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
 * 根标题的文字从哪来 —— 用户选的那个公式属性，在**这一条笔记上**求值。
 * 所以每篇笔记可以有各自的根。没选、或求值为空都表示「不过滤」。
 */
function readRootText(entry: BasesEntry, host: BoardHost): string {
	const source = host.outlineRootId;
	if (source === null) return '';

	const value = entry.getValue(source);
	if (value === null || !value.isTruthy()) return '';
	return value.toString().trim();
}

/**
 * 圈出要渲染的范围。
 *
 * 没填根：整篇笔记，baseLevel 为 0（层级就是绝对层级）。
 * 填了根：取文字完全匹配的那个标题（trim 之后），只要它下面那棵子树 ——
 * 也就是从它之后、到下一个不比它浅的标题为止。根本身不出现。
 * 找不到匹配：返回空，整块大纲不渲染。
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
		// 遇到不比根浅的，说明已经出了这棵子树
		if (all[i].level <= baseLevel) break;
		subtree.push(all[i]);
	}
	return { headings: subtree, baseLevel };
}
