import { type App, Platform, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_HIGHLIGHTER_ALPHA, DEFAULT_PAPER_WIDTH, PALETTE, SIZES } from "./constants";
import { MANUAL_PROVIDER_ID } from "./recognition/manual";
import { providerLabel } from "./recognition/registry";
import type InkedMarkPlugin from "./main";

export type ToolId = "pen" | "highlighter" | "eraser" | "select";

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
  /** On-screen raw pointer-event overlay for input diagnostics. */
  debugHud: boolean;
  /** Whether the one-time iPad "disable Scribble" notice has been shown. */
  scribbleNoticeShown: boolean;
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
  debugHud: false,
  scribbleNoticeShown: false,
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

    if (Platform.isIosApp && Platform.isTablet) {
      const callout = containerEl.createDiv({ cls: "inkedmark-callout" });
      callout.createEl("div", {
        cls: "inkedmark-callout-title",
        text: "iPad: turn off Scribble for reliable handwriting",
      });
      callout.createEl("div", {
        text:
          "iPadOS “Scribble” intercepts fast Apple Pencil strokes before InkedMark " +
          "receives them, causing missing strokes. Disable it in the iPad Settings app: " +
          "Apple Pencil → Scribble (off).",
      });
    }

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

    const tools: Record<ToolId, string> = {
      pen: "Pen",
      highlighter: "Highlighter",
      eraser: "Eraser",
      select: "Select",
    };
    new Setting(containerEl)
      .setName("Default tool")
      .setDesc("Tool selected when an ink note opens.")
      .addDropdown((dropdown) => {
        for (const [id, label] of Object.entries(tools)) dropdown.addOption(id, label);
        dropdown.setValue(this.plugin.settings.defaultTool).onChange(async (value) => {
          this.plugin.settings.defaultTool = value as ToolId;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Default stroke size").addDropdown((dropdown) => {
      for (const size of SIZES) dropdown.addOption(String(size), String(size));
      dropdown.setValue(String(this.plugin.settings.defaultSize)).onChange(async (value) => {
        this.plugin.settings.defaultSize = Number(value);
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl)
      .setName("Highlighter opacity")
      .setDesc("Transparency of highlighter strokes.")
      .addSlider((slider) =>
        slider
          .setLimits(10, 100, 5)
          .setValue(Math.round(this.plugin.settings.highlighterAlpha * 100))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.highlighterAlpha = value / 100;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Custom colors")
      .setDesc("Extra palette swatches, as comma-separated hex (e.g. #ff8800, #00ccaa).")
      .addText((text) =>
        text
          .setPlaceholder("#ff8800, #00ccaa")
          .setValue(this.plugin.settings.customColors.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.customColors = value
              .split(",")
              .map((c) => c.trim())
              .filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Handwriting recognition")
      .setDesc("Provider that turns strokes into searchable text. v1 is manual transcription.")
      .addDropdown((dropdown) => {
        for (const id of this.plugin.providers.keys()) dropdown.addOption(id, providerLabel(id));
        dropdown.setValue(this.plugin.settings.recognitionProviderId).onChange(async (value) => {
          this.plugin.settings.recognitionProviderId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Support and diagnostics").setHeading();

    new Setting(containerEl)
      .setName("Input debug overlay")
      .setDesc(
        "Show raw pen/touch event data on the canvas — event sequence, coalesced counts, " +
          "timing gaps, and stroke totals. Useful when reporting missing or broken strokes.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugHud).onChange(async (value) => {
          await this.plugin.setDebugHud(value);
        }),
      );

    const support = containerEl.createDiv({ cls: "inkedmark-support" });
    support.appendText("Questions or bug reports: ");
    support.createEl("a", {
      text: "support@inkedmark.com",
      href: "mailto:support@inkedmark.com",
    });
    support.appendText(" · ");
    support.createEl("a", {
      text: "GitHub issues",
      href: "https://github.com/pcrausaz/obsidian-inkedmark/issues",
    });
  }
}
