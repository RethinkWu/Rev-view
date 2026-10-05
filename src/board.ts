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
 * 渲染引擎：把一串 entries 按一串属性逐层分组，渲染成嵌套看板。
 *
 * 这里只关心「怎么画」，不关心「属性列表从哪来」—— 后者由视图自己决定，
 * 所以换一种配置来源（公式字符串 / 排序字段 / ...）不用动这个文件。
 */

/**
 * 分组值为空时看板的标题 key。属性缺失或值是空字符串都算空，每一层都会出现。
 * 存 key 不存文案 —— 模块加载时 `initLanguage()` 还没跑。
 */
const EMPTY_GROUP_LABEL_KEY: MessageKey = 'ungroup';

/**
 * 渲染看板需要视图提供的东西。
 * `BasesView` 自己就满足这个形状（它有 app / config / type / hoverPopover），
 * 所以调用时直接传 `this`。
 */
export interface BoardHost extends HoverParent {
	app: App;
	config: BasesViewConfig;
	/** 视图的 type id —— 也是它在 registerHoverLinkSource 里注册的 source id。 */
	type: string;
	/** 大纲最多画到第几级标题。0 = 不渲染。 */
	outlineDepth: number;
	/** 大纲默认是否展开。 */
	outlineAutoExpand: boolean;
	/** 给出大纲根标题的公式属性；null = 整篇笔记。 */
	outlineRootId: BasesPropertyId | null;
	/** 大纲折叠开关上显示的文字。 */
	outlineLabel: string;
	/** 每篇笔记的大纲开合状态（true = 展开）。视图实例持有，全量重建之后仍然保留。 */
	outlineOpen: Map<string, boolean>;
}

/**
 * 渲染预算 —— 条目数 + 看板数，超过就一个都不画。
 *
 * `onDataUpdated` 是整块拆掉重建的，所以这个数字直接决定卡不卡。
 * 2000 大概对应一两万个 DOM 节点，那个量级上重建已经能感觉到停顿。
 * 真正危险的是没加过滤的 base（官方指南也专门警告过这点）：上万条笔记乘上层数，
 * 会在一次重建里把界面冻住。
 */
const RENDER_BUDGET = 2000;

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
	host: BoardHost,
): void {
	// 先只数一遍要画多少东西 —— 纯计数、不建 DOM。超了就罢工，免得把界面冻住。
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
 * 渲染一层：把 entries 按 properties[depth] 分成若干看板。
 * 还有下一层就递归，已经是最后一层就把 entries 平铺成卡片。
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
			// 标一下：这一列装的是子看板，宽度要跟着子看板那一排走
			columnEl.addClass('refine-column--parent');
			renderLevel(columnEl, bucket, properties, depth + 1, host);
		} else {
			renderCards(columnEl, bucket, host);
		}
	}
}

/** 不嵌套时：一个 Ungroup 看板，里面平铺所有 entries。 */
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
 * 一张卡片，结构跟 Bases 内置的卡片视图一致：
 *   第一项属性当标题（不带标签），其余属性各占一块，display name 在值上面、字号更小。
 * 顺序、显示名、以及哪个属性打头，全部来自 Properties 菜单（config.getOrder()）。
 */
function renderCard(cardEl: HTMLElement, entry: BasesEntry, host: BoardHost): void {
	// 整张卡片可点 —— 跳到这条笔记。带 Ctrl/Cmd 时开新标签页。
	cardEl.addEventListener('click', (evt) => {
		void host.app.workspace
			.getLeaf(evt.ctrlKey || evt.metaKey)
			.openFile(entry.file);
	});

	// 悬停弹笔记预览。弹窗本身由 Page preview 核心插件负责，我们只发事件。
	cardEl.addEventListener('mouseover', (evt) => {
		// 在卡片内部移动时 relatedTarget 还落在卡片里 —— 别重复发
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

	// 卡片底部的大纲。没有标题就整块不出现。
	renderOutline(cardEl.createDiv('refine-card-outline'), entry, host);
}

/** 标题位：只画值，不画 display name。Properties 菜单是空的就没有标题。 */
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

/**
 * 数一遍会画出多少个看板。
 * 结构跟 renderLevel 一一对应，但不建任何 DOM —— 分组本身很快，贵的是往页面里塞。
 * 一旦超过预算就立刻收手，不再往下数。
 */
function countBoards(
	entries: BasesEntry[],
	properties: BasesPropertyId[],
	depth: number,
	budget: number,
): number {
	// 光条目就已经超预算了，不必再数
	if (entries.length > budget) return budget + 1;

	const property = properties[depth];
	if (property === undefined) return 1; // 平铺时的那一个 Ungroup 看板

	let total = 0;
	for (const [, bucket] of bucketEntries(entries, property)) {
		total += 1;
		if (depth + 1 < properties.length) {
			total += countBoards(bucket, properties, depth + 1, budget);
		}
		if (total > budget) return total; // 已经超了，数不准也无所谓
	}
	return total;
}

