import { getLanguage } from 'obsidian';

/** Minimal i18n: the English table is the base, and other locales fall back to it. */

const EN = {
	outline: 'Outline',
	viewName: 'Refine',
	outlineLabel: 'Outline label',
	nestDepth: 'Nest depth',
	numberPlaceholder: 'number',
	headingDepth: 'Heading depth',
	outlineSections: 'Outline sections',
	autoExpandOutline: 'Auto expand outline',
	ungroup: 'Ungroup',
	columnWidth: 'Column width',
	columnHeight: 'Column height',
	tooMuchToDraw:
		'Too much to draw — {entries} notes across {boards} boards (limit {limit}). Narrow the filters, or lower Nest depth.',
	badNestDepth:
		'Nest depth expects a whole number — "{value}" was ignored, nesting by every sort field instead.',
};

/** Keys of the English table. */
export type MessageKey = keyof typeof EN;

type Dictionary = Partial<Record<MessageKey, string>>;

const ZH: Dictionary = {
	outline: '大纲',
	outlineLabel: '大纲标题',
	nestDepth: '嵌套层数',
	numberPlaceholder: '数字',
	headingDepth: '标题层级',
	outlineSections: '大纲章节',
	autoExpandOutline: '默认展开大纲',
	ungroup: '未分组',
	columnWidth: '看板宽度',
	columnHeight: '看板高度',
	tooMuchToDraw: '要画的东西太多了 —— {entries} 条笔记、{boards} 个看板（上限 {limit}）。缩小筛选范围，或者调低嵌套层数。',
	badNestDepth: '嵌套层数要填整数 —— 已忽略 "{value}"，改成按全部排序字段嵌套。',
};

const ZH_TW: Dictionary = {
	outline: '大綱',
	outlineLabel: '大綱標題',
	nestDepth: '巢狀層數',
	numberPlaceholder: '數字',
	headingDepth: '標題層級',
	outlineSections: '大綱章節',
	autoExpandOutline: '預設展開大綱',
	ungroup: '未分組',
	columnWidth: '看板寬度',
	columnHeight: '看板高度',
	tooMuchToDraw: '要畫的東西太多了 —— {entries} 條筆記、{boards} 個看板（上限 {limit}）。縮小篩選範圍，或調低巢狀層數。',
	badNestDepth: '巢狀層數需要整數 —— 已忽略 "{value}"，改為以全部排序欄位進行巢狀。',
};

const JA: Dictionary = {
	outline: 'アウトライン',
	viewName: 'リファイン',
	outlineLabel: 'アウトラインのラベル',
	nestDepth: 'ネストの深さ',
	numberPlaceholder: '数値',
	headingDepth: '見出しの深さ',
	outlineSections: 'アウトラインのセクション',
	autoExpandOutline: 'アウトラインを自動展開',
	ungroup: '未分類',
	columnWidth: 'ボードの幅',
	columnHeight: 'ボードの高さ',
	tooMuchToDraw:
		'描画量が多すぎます —— {entries} 件のノート、{boards} 個のボード（上限 {limit}）。フィルタを絞るか、ネストの深さを下げてください。',
	badNestDepth:
		'ネストの深さは整数で指定してください —— "{value}" は無視し、すべての並べ替え項目でネストします。',
};

const DICTIONARIES: ReadonlyMap<string, Dictionary> = new Map([
	['en', EN],
	['zh', ZH],
	['zh-TW', ZH_TW],
	['ja', JA],
]);

let language = 'en';

/** Must run before any t() call. */
export function initLanguage(): void {
	language = getLanguage().toLowerCase();
}

/** Looks up a key; `{name}` in the string is filled from vars. */
export function t(key: MessageKey, vars?: Readonly<Record<string, string>>): string {
	const template = lookup(key);
	return vars === undefined ? template : interpolate(template, vars);
}

function lookup(key: MessageKey): string {
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
