import { BasesEntry, BasesPropertyId } from 'obsidian';

/**
 * 渲染引擎：把一串 entries 按一串属性逐层分组，渲染成嵌套看板。
 *
 * 这里只关心「怎么画」，不关心「属性列表从哪来」—— 后者由视图自己决定，
 * 所以换一种配置来源（公式字符串 / 排序字段 / ...）不用动这个文件。
 */

/** 分组值为空时看板的标题。属性缺失或值是空字符串都算空，每一层都会出现。 */
export const EMPTY_GROUP_LABEL = 'Ungroup';

/** 渲染一张卡片。卡片里放什么由视图决定。 */
export type CardRenderer = (cardEl: HTMLElement, entry: BasesEntry) => void;

/**
 * 层数越深越离谱，到这些档位各提醒一句。
 * 一层都没到就哪个都不显示。
 */
const DEPTH_REMINDERS: ReadonlyArray<readonly [number, string]> = [
	[5, 'Five levels deep.'],
	[8, 'Eight levels. The notes were supposed to be flat.'],
	[12, 'Twelve levels. This is no longer a board, it is a tower.'],
];

/**
 * 把 entries 渲染成嵌套看板，挂在 containerEl 下。
 *
 * properties 决定层级，第一个最外；空数组表示不嵌套，全部平铺进一个 Ungroup 看板。
 * entries 的顺序原样保留（Bases 已经按用户的排序配好了），这里从不重排。
 */
export function renderBoard(
	containerEl: HTMLElement,
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	renderCard: CardRenderer,
): void {
	const reminder = deepestReminder(properties.length);
	if (reminder !== null) {
		containerEl.createDiv({ cls: 'refine-reminder', text: reminder });
	}

	if (properties.length === 0) {
		renderFlat(containerEl, entries, renderCard);
		return;
	}
	renderLevel(containerEl, entries, properties, 0, renderCard);
}

/**
 * 渲染一层：把 entries 按 properties[depth] 分成若干看板。
 * 还有下一层就递归，已经是最后一层就把 entries 平铺成卡片。
 */
function renderLevel(
	parentEl: HTMLElement,
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	depth: number,
	renderCard: CardRenderer,
): void {
	const property = properties[depth];
	if (property === undefined) return;

	const columnsEl = parentEl.createDiv('refine-columns');
	for (const [label, bucket] of bucketEntries(entries, property)) {
		const columnEl = columnsEl.createDiv('refine-column');
		columnEl.createEl('h3', { text: label ?? EMPTY_GROUP_LABEL });

		if (depth + 1 < properties.length) {
			// 标一下：这一列装的是子看板，宽度要跟着子看板那一排走
			columnEl.addClass('refine-column--parent');
			renderLevel(columnEl, bucket, properties, depth + 1, renderCard);
		} else {
			renderCards(columnEl, bucket, renderCard);
		}
	}
}

/** 不嵌套时：一个 Ungroup 看板，里面平铺所有 entries。 */
function renderFlat(
	parentEl: HTMLElement,
	entries: BasesEntry[],
	renderCard: CardRenderer,
): void {
	const columnsEl = parentEl.createDiv('refine-columns');
	const columnEl = columnsEl.createDiv('refine-column');
	columnEl.createEl('h3', { text: EMPTY_GROUP_LABEL });
	renderCards(columnEl, entries, renderCard);
}

function renderCards(
	columnEl: HTMLElement,
	entries: BasesEntry[],
	renderCard: CardRenderer,
): void {
	const cardListEl = columnEl.createDiv('refine-card-list');
	for (const entry of entries) {
		renderCard(cardListEl.createDiv('refine-card'), entry);
	}
}

/**
 * 按某个属性的值把 entries 分桶，保持首次出现的顺序（沿用 Bases 自己的排序）。
 * 值缺失或为空字符串的归到 key 为 `null` 的桶。
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

/** 取层数达到的最深那一档提醒，没到第一档就返回 null。 */
function deepestReminder(depth: number): string | null {
	let found: string | null = null;
	for (const [threshold, text] of DEPTH_REMINDERS) {
		if (depth >= threshold) found = text;
	}
	return found;
}
