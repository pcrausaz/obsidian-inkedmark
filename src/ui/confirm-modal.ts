/** Async confirm dialog (replaces the blocking `confirm()`, per §5). */

import { type App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the confirming button. */
  cta: string;
}

export class ConfirmModal extends Modal {
  private resolved = false;
  private resolve!: (confirmed: boolean) => void;

  constructor(
    app: App,
    private readonly options: ConfirmOptions,
  ) {
    super(app);
  }

  /** Open the modal and resolve true iff the user confirms. */
  static confirm(app: App, options: ConfirmOptions): Promise<boolean> {
    const modal = new ConfirmModal(app, options);
    const promise = new Promise<boolean>((resolve) => {
      modal.resolve = resolve;
    });
    modal.open();
    return promise;
  }

  override onOpen(): void {
    this.titleEl.setText(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });
    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText(this.options.cta)
          .setCta()
          .onClick(() => {
            this.resolved = true;
            this.resolve(true);
            this.close();
          }),
      )
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(false);
  }
}
