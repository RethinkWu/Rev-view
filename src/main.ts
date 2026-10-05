import { BasesPropertyId, BasesView, Plugin, QueryController } from 'obsidian';
import { renderBoard } from './board';

export const REFINE_VIEW_TYPE = 'refine-view';
export const REFINE_NAME = 'Ref:iИe';

/** 视图选项 key：排序列表的前几项拿来当嵌套层级。 */
const NEST_DEPTH_KEY = 'nest-depth';

export default class RevViewPlugin extends Plugin {
	async onload() {
		this.registerBasesView(REFINE_VIEW_TYPE, {
			name: REFINE_NAME,
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
					displayName: 'Nest depth',
					placeholder: 'number',
				},
			],
		});
	}
}

export class RefineBasesView extends BasesView {
	readonly type = REFINE_VIEW_TYPE;
	private containerEl: HTMLElement;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv('refine-container');
	}

	public onDataUpdated(): void {
		this.containerEl.empty();

		const { properties, badDepth } = this.readNestConfig();
		if (badDepth !== null) {
			this.containerEl.createDiv({
				cls: 'refine-warning',
				text: `Nest depth expects a whole number — "${badDepth}" was ignored, nesting by every sort field instead.`,
			});
		}

		renderBoard(this.containerEl, this.data.data, properties, this);
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
