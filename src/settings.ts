import { type App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_HIGHLIGHTER_ALPHA, DEFAULT_PAPER_WIDTH, PALETTE, SIZES } from "./constants";
import { MANUAL_PROVIDER_ID } from "./recognition/manual";
import type InkedMarkPlugin from "./main";

export type ToolId = "pen" | "eraser" | "select" | "pan";

export interface InkedMarkSettings {
  pressureEnabled: boolean;
  defaultTool: ToolId;
  customColors: string[];
  defaultColor: string;
  defaultSize: number;
  highlighterAlpha: number;
  paperWidth: number;
  recognitionProviderId: string;
  twoFileStorage: boolean;
  desynchronizedCanvas: boolean;
}

export const DEFAULT_SETTINGS: InkedMarkSettings = {
  pressureEnabled: true,
  defaultTool: "pen",
  customColors: [],
  defaultColor: PALETTE[0],
  defaultSize: SIZES[1],
  highlighterAlpha: DEFAULT_HIGHLIGHTER_ALPHA,
  paperWidth: DEFAULT_PAPER_WIDTH,
  recognitionProviderId: MANUAL_PROVIDER_ID,
  twoFileStorage: false,
  desynchronizedCanvas: true,
};

export class InkedMarkSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InkedMarkPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Pressure sensitivity")
      .setDesc("Use pen pressure to vary stroke width (pen/stylus only).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pressureEnabled).onChange(async (value) => {
          this.plugin.settings.pressureEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Desynchronized canvas")
      .setDesc(
        "Low-latency rendering hint. Turn off if ink looks corrupted on your device (historically flaky on iOS WebKit).",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.desynchronizedCanvas).onChange(async (value) => {
          this.plugin.settings.desynchronizedCanvas = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Paper width")
      .setDesc("Logical width of the paper roll, in pixels.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.paperWidth)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed >= 320 && parsed <= 4096) {
            this.plugin.settings.paperWidth = parsed;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Default ink color")
      .setDesc("Color selected when a new ink note opens.")
      .addColorPicker((picker) =>
        picker.setValue(this.plugin.settings.defaultColor).onChange(async (value) => {
          this.plugin.settings.defaultColor = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
