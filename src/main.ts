import { BasesEntry, BasesView, Plugin, QueryController } from 'obsidian';

export const REV_VIEW_TYPE = 'rev-view';
export const REV_VIEW_NAME = 'Rev:View';

export default class RevViewPlugin extends Plugin {
	async onload() {
		this.registerBasesView(REV_VIEW_TYPE, {
			name: REV_VIEW_NAME,
			icon: 'lucide-notebook-pen',
			factory: (controller, containerEl) => {
				return new RevBasesView(controller, containerEl);
			},
		});
	}
}

export class RevBasesView extends BasesView {
	readonly type = REV_VIEW_TYPE;
	private containerEl: HTMLElement;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv('rev-view-container');
	}

	public onDataUpdated(): void {
		this.containerEl.empty();
		this.renderUnGroups();
	}

	private renderUnGroups(): void {
		for (const group of this.data.groupedData) {
			const columnEl = this.containerEl.createDiv('rev-view-column');
			columnEl.createEl('h3', { text: 'Ungroup' });
			const cardListEl = columnEl.createDiv('rev-view-card-list');
			for (const entry of group.entries) {
				cardListEl.createDiv('rev-view-card');
			}
		}
	}

	private renderCard(cardEl: HTMLElement, entry: BasesEntry): void {
		cardEl.createEl('h4', { text: entry.file.name });
	}
}
