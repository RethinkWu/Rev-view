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

/** 视图选项 key：排序列表的前几项拿来当嵌套层级。 */
const NEST_DEPTH_KEY = 'nest-depth';

/** 视图选项 key：大纲最多渲染到第几级标题。0 = 不渲染。 */
const HEADING_DEPTH_KEY = 'heading-depth';

/** 视图选项 key：给出大纲根标题的公式属性。没选 = 整篇笔记。 */
const OUTLINE_ROOT_KEY = 'outline-root';

/** 视图选项 key：大纲默认就是展开的。 */
const OUTLINE_EXPANDED_KEY = 'outline-expanded';

/** 视图选项 key：大纲折叠开关上显示的文字。 */
const OUTLINE_LABEL_KEY = 'outline-label';

/** 视图选项 key：看板默认宽度（px）。嵌套层按比例自动收窄，不用另配。 */
const COLUMN_WIDTH_KEY = 'column-width';

/** 视图选项 key：看板最大高度（px）。超过就在卡片列表里滚。 */
const COLUMN_HEIGHT_KEY = 'column-height';

/** 滑条没给出值时的兜底宽度，跟 CSS 里的默认值保持一致。 */
const DEFAULT_COLUMN_WIDTH = 340;

/** 看板高度滑条的默认值（px）。780 是实测调出来的 —— 大约够放 10 张只有标题的卡片。 */
const DEFAULT_COLUMN_HEIGHT = 780;

/** 数据变动后等这么久再重建。Bases 在任何 vault 变动时都会回调，防抖掉连续触发。 */
const RENDER_DELAY_MS = 100;

export default class RevViewPlugin extends Plugin {
	async onload() {
		// 最先跑 —— 后面所有 t() 都靠它
		initLanguage();

		// 视图在选择器里显示的名字。按界面语言取，正常就是 Refine（日语片假名）。
		const viewName = t('viewName');

		// 把本视图注册成 hover-link 事件的发射源 —— Page preview 核心插件只认识
		// 注册过的 source，卡片悬停才会弹预览。
		// display 会出现在它的设置里，官方说这个字段应该匹配「插件」显示名，不是视图名。
		this.registerHoverLinkSource(REFINE_VIEW_TYPE, {
			display: this.manifest.name,
			// true = 默认要按住 Mod（Ctrl/Cmd）才弹，跟 Obsidian 原版链接一致。
			// 用户可以在 Page preview 的设置里单独给这个来源关掉。
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
					// 嵌套层级直接取自 Bases 自己的 Sort 菜单 —— 那里的顺序就是分组顺序，
					// 而且每个字段都是官方的属性选择器，不需要任何字符串匹配。
					//
					// 层数决定排序列表里前几项拿来分组，剩下的仍然纯排序：Bases 已经按它们
					// 把 data 排好序了，我们从不重排，所以效果落在最内层的卡片顺序上。
					type: 'text',
					key: NEST_DEPTH_KEY,
					displayName: t('nestDepth'),
					placeholder: t('numberPlaceholder'),
				},
				{
					// 和 Nest by 一个套路：公式属性的值就是根标题的文字。
					// 这样根可以每篇笔记不同（公式能引用 frontmatter），不用手打。
					// 没选 = 整篇笔记的标题都出。
					type: 'property',
					key: OUTLINE_ROOT_KEY,
					displayName: t('outlineRoot'),
					filter: (propertyId) => propertyId.startsWith('formula.'),
				},
				{
					// 大纲折叠开关上显示的文字。用 placeholder 而不是 default ——
					// 留空就跟着界面语言走，一旦填了才会被固定进 .base 文件。
					type: 'text',
					key: OUTLINE_LABEL_KEY,
					displayName: t('outlineLabel'),
					placeholder: t('outline'),
				},
				{
					// 默认就把大纲展开，不用一张张点。单张卡片的开合仍然记得住。
					type: 'toggle',
					key: OUTLINE_EXPANDED_KEY,
					displayName: t('autoExpandOutline'),
					default: false,
				},
				{
					// 看板默认多宽。嵌套层级会按比例自动收窄，不用另外配。
					type: 'slider',
					key: COLUMN_WIDTH_KEY,
					displayName: t('columnWidth'),
					min: 200,
					max: 600,
					step: 20,
					default: DEFAULT_COLUMN_WIDTH,
				},
				{
					// 看板最高能到多少。超过就在卡片列表里滚，不再把列撑长。
					type: 'slider',
					key: COLUMN_HEIGHT_KEY,
					displayName: t('columnHeight'),
					min: 200,
					max: 1600,
					step: 20,
					default: DEFAULT_COLUMN_HEIGHT,
				},
				{
					// 最多画到第几级标题，超过的直接不画。0 = 整个大纲不渲染。
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

	/** 大纲最多画到第几级标题。0 = 不渲染。每次重建时从选项里刷新。 */
	outlineDepth = 1;
	/** 大纲默认是否展开。每次重建时从选项里刷新。 */
	outlineAutoExpand = false;
	/** 给出根标题的公式属性；null = 整篇笔记。 */
	outlineRootId: BasesPropertyId | null = null;
	/** 大纲折叠开关上显示的文字。 */
	outlineLabel = '';
	/** 看板默认宽度（px）。每次重建时从选项里刷新。 */
	columnWidth = DEFAULT_COLUMN_WIDTH;
	/** 看板最大高度（px）。每次重建时从选项里刷新。 */
	columnHeight = DEFAULT_COLUMN_HEIGHT;
	/**
	 * 每篇笔记的大纲开合状态（true = 展开）。
	 * 没记录的走 outlineAutoExpand。放实例上 —— 模块级变量会让分屏的多个视图互相串。
	 */
	readonly outlineOpen = new Map<string, boolean>();

	private containerEl: HTMLElement;
	private renderTimer: number | null = null;
	/** 上一轮画出来的指纹。一样就跳过重建。 */
	private lastSignature = '';

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv('refine-container');

		this.register(() => {
			if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		});
	}

	/**
	 * Bases 在任何 vault 变动时都会回调这里。立刻重建会在连续改动（比如打字）时
	 * 反复把整个看板拆掉重来，所以延后一拍，连续触发只重建一次。
	 */
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

		// 跟上一轮要画的东西一模一样 —— 一个 DOM 都不碰。
		// Bases 在任何 vault 变动时都会回调（实测：编辑一篇不在 base 里的笔记也会），
		// 这一步挡掉绝大多数无谓重建。
		const signature = this.renderSignature(properties, badDepth);
		if (signature === this.lastSignature) return;
		this.lastSignature = signature;

		// 宽高都走 CSS 变量，设在容器上就会继承给里面所有看板
		this.containerEl.style.setProperty(
			'--refine-column-width',
			`${String(this.columnWidth)}px`,
		);
		this.containerEl.style.setProperty(
			'--refine-column-max-height',
			`${String(this.columnHeight)}px`,
		);

		// 先在游离节点里画完，再一次性换进去 —— 避免「先清空、再慢慢长出来」的闪烁
		const staging = createDiv();

		if (badDepth !== null) {
			staging.createDiv({
				cls: 'refine-warning',
				text: t('badNestDepth', { value: badDepth }),
			});
		}

		renderBoard(staging, this.data.data, properties, this);

		// 逐个搬过去（append 会把它从 staging 里摘下来，循环自然收敛）
		this.containerEl.empty();
		while (staging.firstChild !== null) {
			this.containerEl.append(staging.firstChild);
		}
	}

	/**
	 * 这一轮要画的东西的指纹：条目（路径 + 修改时间 + 用到的属性值）、顺序，
	 * 以及所有会影响输出的选项。跟上一轮一样就整次跳过。
	 */
	private renderSignature(
		properties: BasesPropertyId[],
		badDepth: string | null,
	): string {
		const order = this.config.getOrder();
		const parts: string[] = [
			properties.join(','),
			// 连显示名一起 —— 用户在 base 里改了属性显示名，卡片上的标签也得跟着变
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

		// 属性值也算进去：公式可能引用别的文件，光看 mtime 会漏掉那种变化
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

	/** 大纲最多画到第几级标题。0 = 整个不渲染；读不到就退回 1。 */
	private readOutlineDepth(): number {
		const depth = Number(this.config.get(HEADING_DEPTH_KEY));
		return Number.isInteger(depth) && depth >= 0 ? depth : 1;
	}

	/**
	 * 嵌套层级 = 排序菜单里前 N 个字段。
	 * 没填层数就用全部；填的不是非负整数就当作没填，并把原样值交回上层报错。
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
