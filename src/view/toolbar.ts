/**
 * Toolbar DOM, reused by the ink view (and later by inline embeds).
 *
 * Phase 0.1 surfaces only what the ink MVP needs: pen, highlighter, a color
 * palette, sizes, a pressure toggle, undo, and clear. Eraser/select/pan/zoom
 * arrive in Phase 0.2.
 */

import { setIcon } from "obsidian";
import type { Tool } from "../model/document";

export interface ToolbarState {
  tool: Tool;
  color: string;
  size: number;
  pressureEnabled: boolean;
}

export interface ToolbarCallbacks {
  onToolChange(tool: Tool): void;
  onColorChange(color: string): void;
  onSizeChange(size: number): void;
  onPressureToggle(enabled: boolean): void;
  onUndo(): void;
  onClear(): void;
}

export class Toolbar {
  private readonly root: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly swatches = new Map<string, HTMLButtonElement>();
  private readonly sizeButtons = new Map<number, HTMLButtonElement>();
  private pressureButton!: HTMLButtonElement;

  constructor(
    container: HTMLElement,
    private readonly palette: readonly string[],
    private readonly sizes: readonly number[],
    private state: ToolbarState,
    private readonly callbacks: ToolbarCallbacks,
  ) {
    this.root = container.createDiv({ cls: "inkedmark-toolbar" });
    this.build();
    this.syncActive();
  }

  private build(): void {
    this.addToolButton("pen", "pencil", "Pen (P)");
    this.addToolButton("highlighter", "highlighter", "Highlighter (H)");
    this.addSeparator();

    for (const color of this.palette) {
      const swatch = this.root.createEl("button", { cls: "inkedmark-swatch" });
      swatch.style.background = color;
      swatch.setAttribute("aria-label", color);
      swatch.addEventListener("click", () => {
        this.state.color = color;
        this.callbacks.onColorChange(color);
        this.syncActive();
      });
      this.swatches.set(color, swatch);
    }
    this.addSeparator();

    for (const size of this.sizes) {
      const button = this.root.createEl("button", { text: String(size) });
      button.setAttribute("aria-label", `Size ${size}`);
      button.addEventListener("click", () => {
        this.state.size = size;
        this.callbacks.onSizeChange(size);
        this.syncActive();
      });
      this.sizeButtons.set(size, button);
    }
    this.addSeparator();

    this.pressureButton = this.iconButton("gauge", "Toggle pressure", () => {
      this.state.pressureEnabled = !this.state.pressureEnabled;
      this.callbacks.onPressureToggle(this.state.pressureEnabled);
      this.syncActive();
    });

    this.iconButton("undo-2", "Undo (Cmd/Ctrl+Z)", () => this.callbacks.onUndo());
    this.iconButton("trash-2", "Clear", () => this.callbacks.onClear());
  }

  private addToolButton(tool: Tool, icon: string, label: string): void {
    const button = this.iconButton(icon, label, () => {
      this.state.tool = tool;
      this.callbacks.onToolChange(tool);
      this.syncActive();
    });
    this.toolButtons.set(tool, button);
  }

  private iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = this.root.createEl("button");
    setIcon(button, icon);
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  private addSeparator(): void {
    this.root.createDiv({ cls: "inkedmark-sep" });
  }

  /** Reflect the current state on the buttons. */
  syncActive(): void {
    for (const [tool, button] of this.toolButtons) {
      button.toggleClass("is-active", tool === this.state.tool);
    }
    for (const [color, swatch] of this.swatches) {
      swatch.toggleClass("is-active", color === this.state.color);
    }
    for (const [size, button] of this.sizeButtons) {
      button.toggleClass("is-active", size === this.state.size);
    }
    this.pressureButton.toggleClass("is-active", this.state.pressureEnabled);
  }

  setState(state: ToolbarState): void {
    this.state = state;
    this.syncActive();
  }

  destroy(): void {
    this.root.remove();
  }
}
