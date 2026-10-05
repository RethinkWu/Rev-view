import { getLanguage } from 'obsidian';

/**
 * 极简 i18n：一张英文表当基准（key 也是英文），别的语言覆盖其中一部分，
 * 没覆盖的自动落回英文。
 *
 * 加一条文案 = 往英文表加一个 key，其他语言表里可选地补上。
 * 加一种语言 = 多一个表、往 DICTIONARIES 里加一行。
 *
 * 注意：**不要在模块级常量里调 `t()`** —— 那时候 `initLanguage()` 还没跑。
 * 模块级只放 key，渲染时再翻。Bases 的选项 displayName 是在 options 回调里求值的，
 * 那时语言已经就绪，所以那里可以直接调。
 */

const EN = {
	outline: 'Outline',
	outlineLabel: 'Outline label',
	nestDepth: 'Nest depth',
	numberPlaceholder: 'number',
	headingDepth: 'Heading depth',
	outlineRoot: 'Outline root',
	autoExpandOutline: 'Auto expand outline',
	ungroup: 'Ungroup',
	tooMuchToDraw:
		'Too much to draw — {entries} notes across {boards} boards (limit {limit}). Narrow the filters, or lower Nest depth.',
	badNestDepth:
		'Nest depth expects a whole number — "{value}" was ignored, nesting by every sort field instead.',
	depthReminder5: 'Five levels deep.',
	depthReminder8: 'Eight levels. The notes were supposed to be flat.',
	depthReminder12: 'Twelve levels. This is no longer a board, it is a tower.',
};

/** 所有文案的 key —— 英文表的键名。 */
export type MessageKey = keyof typeof EN;

type Dictionary = Partial<Record<MessageKey, string>>;

const ZH: Dictionary = {
	outline: '大纲',
	outlineLabel: '大纲标题',
	nestDepth: '嵌套层数',
	numberPlaceholder: '数字',
	headingDepth: '标题层级',
	outlineRoot: '大纲根标题',
	autoExpandOutline: '默认展开大纲',
	ungroup: '未分组',
	tooMuchToDraw: '要画的东西太多了 —— {entries} 条笔记、{boards} 个看板（上限 {limit}）。缩小筛选范围，或者调低嵌套层数。',
	badNestDepth: '嵌套层数要填整数 —— 已忽略 "{value}"，改成按全部排序字段嵌套。',
	depthReminder5: '已经五层了。',
	depthReminder8: '八层。笔记本来是平铺的。',
	depthReminder12: '十二层。这已经不是看板，是塔。',
};

const ZH_TW: Dictionary = {
	outline: '大綱',
	outlineLabel: '大綱標題',
	nestDepth: '巢狀層數',
	numberPlaceholder: '數字',
	headingDepth: '標題層級',
	outlineRoot: '大綱根標題',
	autoExpandOutline: '預設展開大綱',
	ungroup: '未分組',
	tooMuchToDraw: '要畫的東西太多了 —— {entries} 條筆記、{boards} 個看板（上限 {limit}）。縮小篩選範圍，或調低巢狀層數。',
	badNestDepth: '巢狀層數需要整數 —— 已忽略 "{value}"，改為以全部排序欄位進行巢狀。',
	depthReminder5: '已經五層了。',
	depthReminder8: '八層。筆記本來是平鋪的。',
	depthReminder12: '十二層。這已經不是看板，是塔。',
};

const JA: Dictionary = {
	outline: 'アウトライン',
	outlineLabel: 'アウトラインのラベル',
	nestDepth: 'ネストの深さ',
	numberPlaceholder: '数値',
	headingDepth: '見出しの深さ',
	outlineRoot: 'アウトラインのルート',
	autoExpandOutline: 'アウトラインを自動展開',
	ungroup: '未分類',
	tooMuchToDraw:
		'描画量が多すぎます —— {entries} 件のノート、{boards} 個のボード（上限 {limit}）。フィルタを絞るか、ネストの深さを下げてください。',
	badNestDepth:
		'ネストの深さは整数で指定してください —— "{value}" は無視し、すべての並べ替え項目でネストします。',
	depthReminder5: 'すでに 5 階層。',
	depthReminder8: '8 階層。ノートは平らなはずだったのに。',
	depthReminder12: '12 階層。これはもうボードではなく塔です。',
};

const DICTIONARIES: ReadonlyMap<string, Dictionary> = new Map([
	['en', EN],
	['zh', ZH],
	['zh-TW', ZH_TW],
	['ja', JA],
]);

let language = 'en';

/** 插件 onload 里最先调 —— 在这一步之前 `t()` 只会给英文。 */
export function initLanguage(): void {
	language = getLanguage().toLowerCase();
}

/** 取一条文案。`{name}` 会被 vars 里同名的值替换。 */
export function t(key: MessageKey, vars?: Readonly<Record<string, string>>): string {
	const template = lookup(key);
	return vars === undefined ? template : interpolate(template, vars);
}

function lookup(key: MessageKey): string {
	// 先精确匹配（zh-TW），再退到主语言（zh），最后退到英文
	const base = language.split('-')[0];
	return (
		DICTIONARIES.get(language)?.[key] ??
		DICTIONARIES.get(base)?.[key] ??
		EN[key]
	);
}

function interpolate(template: string, vars: Readonly<Record<string, string>>): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}
