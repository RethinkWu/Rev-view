import { BasesPropertyId, BasesView, Plugin, QueryController } from 'obsidian';
import { renderBoard } from './board';

export const REFINE_VIEW_TYPE = 'refine-view';
export const REFINE_NAME = 'Ref:iИe';

/** 视图选项 key：排序列表的前几项拿来当嵌套层级。 */
const NEST_DEPTH_KEY = 'nest-depth';

/** 「层数」的可选值：全部排序字段都当嵌套层级。 */
const DEPTH_ALL = 'all';

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
					// 排在「嵌套层数」之外的排序字段依然生效：Bases 已经按它们把 data
					// 排好序了，我们从不重排，所以效果会落在最内层的卡片顺序上。
					type: 'dropdown',
					key: NEST_DEPTH_KEY,
					displayName: 'Nest depth',
					default: DEPTH_ALL,
					options: {
						[DEPTH_ALL]: 'All sort fields',
						'1': 'First sort field only',
						'2': 'First 2 sort fields',
						'3': 'First 3 sort fields',
						'4': 'First 4 sort fields',
						'5': 'First 5 sort fields',
						'6': 'First 6 sort fields',
					},
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
		renderBoard(
			this.containerEl,
			this.data.data,
			this.readNestProperties(),
			(cardEl, entry) => {
				cardEl.createEl('h4', { text: entry.file.name });
			},
		);
	}

	/**
	 * 嵌套层级 = 排序菜单里前 N 个字段。
	 * 没配排序时返回空数组 —— 上层会平铺成一个 Ungroup 看板。
	 */
	private readNestProperties(): BasesPropertyId[] {
		const sorted = this.config.getSort().map((entry) => entry.property);
		const selected: unknown = this.config.get(NEST_DEPTH_KEY);

		if (typeof selected !== 'string' || selected === DEPTH_ALL) return sorted;

		const depth = Number.parseInt(selected, 10);
		if (!Number.isFinite(depth)) return sorted;
		return sorted.slice(0, depth);
	}
}
