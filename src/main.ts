import {
	BasesEntry,
	BasesPropertyId,
	BasesView,
	ListValue,
	Plugin,
	QueryController,
} from 'obsidian';

export const REFINE_VIEW_TYPE = 'refine-view';
export const REFINE_NAME = 'Ref:iИe';

/** 视图选项 key：用户在这里选一个「内容是一串属性的列表」的公式属性。 */
const NEST_BY_KEY = 'nest-by';

/** 公式列表里只写了裸属性名（`project`）时，按这个顺序去 allProperties 里找。 */
const TYPE_PREFERENCE = ['note', 'formula', 'file'] as const;

/** 分组值为空时看板的标题。属性缺失或值是空字符串都算空，每一层都会出现。 */
const EMPTY_GROUP_LABEL = 'Ungroup';

/**
 * 层数越深越离谱，到这些档位各提醒一句。
 * 一层都没到就哪个都不显示。
 */
const DEPTH_REMINDERS: ReadonlyArray<readonly [number, string]> = [
	[5, 'Five levels deep.'],
	[8, 'Eight levels. The notes were supposed to be flat.'],
	[12, 'Twelve levels. This is no longer a board, it is a tower.'],
];

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
					// filter 把下拉收窄到 formula.* —— 用户先在 base 里建一个内容是
					// ["属性", "属性"] 的公式属性，再在这里选它。
					type: 'property',
					key: NEST_BY_KEY,
					displayName: 'Nest by',
					filter: (propertyId) => propertyId.startsWith('formula.'),
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

		const { properties, unresolved } = this.readNestConfig();
		if (unresolved.length > 0) {
			this.renderUnresolved(unresolved);
		}

		if (properties.length === 0) {
			// 没配 Nest by：不嵌套，所有笔记平铺进一个 Ungroup 看板
			this.renderCardsBoard(this.containerEl, this.data.data);
			return;
		}

		const reminder = deepestReminder(properties.length);
		if (reminder !== null) {
			this.containerEl.createDiv({ cls: 'refine-reminder', text: reminder });
		}

		this.renderLevel(this.containerEl, this.data.data, properties, 0);
	}

	/** 公式里有条目对不上属性时，说清楚是哪些、以及该怎么改。 */
	private renderUnresolved(unresolved: string[]): void {
		const box = this.containerEl.createDiv({ cls: 'refine-warning' });
		const noun = unresolved.length === 1 ? 'entry' : 'entries';
		box.createDiv({
			text: `Nest by — ${unresolved.length} ${noun} didn't match a property:`,
		});

		const listEl = box.createEl('ul');
		for (const name of unresolved) {
			listEl.createEl('li', { text: name });
		}

		box.createEl('p', {
			text: 'Each entry must be a quoted property ID, e.g. "note.project". Unquoted entries resolve to a note’s value, not the property name.',
		});
	}

	/**
	 * 渲染一层：把 entries 按 properties[depth] 分成若干看板。
	 * 还有下一层就递归，已经是最后一层就把 entries 平铺成卡片。
	 */
	private renderLevel(
		parentEl: HTMLElement,
		entries: BasesEntry[],
		properties: BasesPropertyId[],
		depth: number,
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
				this.renderLevel(columnEl, bucket, properties, depth + 1);
			} else {
				this.renderCards(columnEl, bucket);
			}
		}
	}

	/** 一个 Ungroup 看板，里面平铺所有 entries。没配 Nest by 时用。 */
	private renderCardsBoard(parentEl: HTMLElement, entries: BasesEntry[]): void {
		const columnsEl = parentEl.createDiv('refine-columns');
		const columnEl = columnsEl.createDiv('refine-column');
		columnEl.createEl('h3', { text: EMPTY_GROUP_LABEL });
		this.renderCards(columnEl, entries);
	}

	private renderCards(columnEl: HTMLElement, entries: BasesEntry[]): void {
		const cardListEl = columnEl.createDiv('refine-card-list');
		for (const entry of entries) {
			this.renderCard(cardListEl.createDiv('refine-card'), entry);
		}
	}

	private renderCard(cardEl: HTMLElement, entry: BasesEntry): void {
		cardEl.createEl('h4', { text: entry.file.name });
	}

	/**
	 * Nest by 选的公式属性求值出来应该是一个列表，比如 ["note.project", "note.milestone"]。
	 * 公式是常量，取哪条笔记求值结果都一样，所以拿第一条当样本就行。
	 * 没选、求值不出列表、或者列表为空时，properties 为空 —— 上层会平铺成 Ungroup 看板。
	 */
	private readNestConfig(): {
		properties: BasesPropertyId[];
		unresolved: string[];
	} {
		const properties: BasesPropertyId[] = [];
		const unresolved: string[] = [];

		const source = this.config.getAsPropertyId(NEST_BY_KEY);
		if (source === null) return { properties, unresolved };

		const sample: BasesEntry | undefined = this.data.data[0];
		const value = sample === undefined ? null : sample.getValue(source);
		if (!(value instanceof ListValue)) return { properties, unresolved };

		for (let i = 0; i < value.length(); i++) {
			// 原样留着：认不出来时要把公式里实际写了什么显示出来
			const raw = value.get(i).toString().trim();
			if (raw === '') continue;

			const id = this.resolvePropertyId(raw);
			if (id === null) unresolved.push(raw);
			else properties.push(id);
		}
		return { properties, unresolved };
	}

	/**
	 * `note.project` 这类完整写法直接认；`project` 这类裸名去 allProperties 里找，
	 * 同名的按 note → formula → file 取第一个。
	 */
	private resolvePropertyId(raw: string): BasesPropertyId | null {
		const name = normalizePropertyRef(raw);
		if (name === null) return null;

		const exact = this.allProperties.find((id) => id === name);
		if (exact !== undefined) return exact;

		for (const type of TYPE_PREFERENCE) {
			const prefixed: string = `${type}.${name}`;
			const match = this.allProperties.find((id) => id === prefixed);
			if (match !== undefined) return match;
		}
		return null;
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

/**
 * 把公式里写出来的各种形状的属性引用收敛成一个字符串，再拿去查表。
 *
 * 名字里带 `.` 之类的字符时，公式编辑器给的写法是下标形式：
 *     formula["LessNo."]   ← 属性引用，求值出的是「值」
 *     "formula.LessNo."    ← 字符串字面量，求值出的是「名字」，我们要的是这个
 * 但为了容错，下标形式也一并还原成 `formula.LessNo.`。
 */
function normalizePropertyRef(raw: string): string | null {
	// 万一用户把外层引号也一起打进去了
	let text = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
	if (text === '') return null;

	// formula["LessNo."] / note['foo'] → formula.LessNo. / note.foo
	const bracket = /^([A-Za-z]+)\s*\[\s*(['"])(.*)\2\s*\]$/.exec(text);
	if (bracket !== null) {
		return `${bracket[1]}.${bracket[3]}`;
	}
	return text;
}

/** 取层数达到的最深那一档提醒，没到第一档就返回 null。 */
function deepestReminder(depth: number): string | null {
	let found: string | null = null;
	for (const [threshold, text] of DEPTH_REMINDERS) {
		if (depth >= threshold) found = text;
	}
	return found;
}
