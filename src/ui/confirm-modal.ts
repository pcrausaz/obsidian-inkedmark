/** Async confirm dialog (replaces the blocking `confirm()`, per §5). */

import { type App, Modal, Setting, requireApiVersion } from "obsidian";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the confirming button. */
  cta: string;
  /** Style the confirming button as destructive (e.g. discarding work). */
  warning?: boolean;
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
      .addButton((button) => {
        button.setButtonText(this.options.cta);
        if (!this.options.warning) button.setCta();
        // setDestructive is 1.13+; older apps get the class setWarning applied.
        else if (requireApiVersion("1.13.0")) button.setDestructive();
        else button.buttonEl.addClass("mod-warning");
        button.onClick(() => {
          this.resolved = true;
          this.resolve(true);
          this.close();
        });
      })
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(false);
  }
}
