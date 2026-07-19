import { type App, type Component, MarkdownRenderer, Modal } from "obsidian";

/** Renders bundled changelog markdown ("What's new" after an update). */
export class WhatsNewModal extends Modal {
  constructor(
    app: App,
    private readonly markdown: string,
    /** Lifecycle owner for the rendered markdown (the plugin). */
    private readonly component: Component,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("What's new in InkedMark");
    this.modalEl.addClass("inkedmark-whats-new");
    void MarkdownRenderer.render(this.app, this.markdown, this.contentEl, "", this.component);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
