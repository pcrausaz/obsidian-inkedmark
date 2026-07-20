import {
  type App,
  Platform,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  type SettingDefinitionItem,
  type TextComponent,
} from "obsidian";
import {
  DEFAULT_HIGHLIGHTER_ALPHA,
  DEFAULT_PAPER_WIDTH,
  PALETTE,
  SIZES,
  TROCR_MODELS,
  TROCR_PROVIDER_ID,
  type TrocrSize,
} from "./constants";
import { MANUAL_PROVIDER_ID } from "./recognition/manual";
import {
  DEFAULT_MODELS,
  LLM_PROVIDER_ID,
  type LlmVendor,
  VENDOR_LABELS,
  chatCompletionsUrl,
  isPlainHttpUrl,
} from "./recognition/llm-request";
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
  /** Last plugin version whose changelog the user has been shown. */
  lastSeenVersion: string;
  /** Cloud recognition (BYOK) configuration. */
  llmVendor: LlmVendor;
  /** Empty string means "use the vendor's default model". */
  llmModel: string;
  llmApiKey: string;
  /** OpenAI-compatible base URL for the `custom` vendor (self-hosted servers). */
  llmBaseUrl: string;
  /**
   * Key sent only to the custom endpoint — kept separate from `llmApiKey` so
   * a cloud vendor secret can never leak to an arbitrary user-configured URL.
   */
  llmCustomApiKey: string;
  /** User has acknowledged that cloud recognition sends ink off-device. */
  cloudConsentGiven: boolean;
  /** Separate consent for the user-configured custom endpoint. */
  customConsentGiven: boolean;
  /** Run cloud recognition automatically after the ink has been idle. */
  autoRecognize: boolean;
  /** Expose the experimental on-device (TrOCR) recognizer. */
  experimentalTrocr: boolean;
  /** On-device model size (accuracy vs download/speed). */
  trocrModel: TrocrSize;
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
  lastSeenVersion: "",
  llmVendor: "anthropic",
  llmModel: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmCustomApiKey: "",
  cloudConsentGiven: false,
  customConsentGiven: false,
  autoRecognize: false,
  experimentalTrocr: false,
  trocrModel: "small",
};

const TOOL_LABELS: Record<ToolId, string> = {
  pen: "Pen",
  highlighter: "Highlighter",
  eraser: "Eraser",
  select: "Select",
};

interface CalloutText {
  title: string;
  body: string;
}

const SCRIBBLE_CALLOUT: CalloutText = {
  title: "iPad: turn off Scribble for reliable handwriting",
  body:
    "iPadOS “Scribble” intercepts fast Apple Pencil strokes before InkedMark " +
    "receives them, causing missing strokes. Disable it in the iPad Settings app: " +
    "Apple Pencil → Scribble (off).",
};

const URL_ERROR_CALLOUT: CalloutText = {
  title: "Incomplete endpoint URL",
  body:
    "Enter the full URL including the scheme, e.g. http://localhost:11434/v1 or " +
    "https://yourbox.your-tailnet.ts.net/v1.",
};

const PAPER_WIDTH_CALLOUT: CalloutText = {
  title: "Paper width out of range",
  body:
    "Enter a whole number of pixels between 320 and 4096 (e.g. 1024). " +
    "The last valid width stays active until then.",
};

const HTTP_WARNING_CALLOUT: CalloutText = {
  title: "Plain-HTTP endpoints often fail on iPhone/iPad",
  body:
    "For access from mobile devices, expose the server over HTTPS — for example " +
    "with “tailscale serve” or a Cloudflare Tunnel (see SELF_HOSTING.md). " +
    "Also note that “localhost” on an iPad is the iPad itself, not your server.",
};

/** Hex swatches parsed from the comma-separated custom-colors field. */
function parseCustomColors(value: string): string[] {
  return value
    .split(",")
    .map((c) => c.trim())
    .filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
}

/** True when a non-empty endpoint URL cannot be resolved to a chat URL. */
function endpointUrlInvalid(url: string): boolean {
  if (!url) return false;
  try {
    chatCompletionsUrl(url);
    return false;
  } catch {
    return true;
  }
}

function buildCallout(parent: HTMLElement, callout: CalloutText): HTMLDivElement {
  const el = parent.createDiv({ cls: "inkedmark-callout" });
  el.createDiv({ cls: "inkedmark-callout-title", text: callout.title });
  el.createDiv({ text: callout.body });
  return el;
}

function buildSupportFooter(parent: HTMLElement): void {
  const support = parent.createDiv({ cls: "inkedmark-support" });
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
  support.appendText(" · ");
  support.createEl("a", {
    text: "Buy me a coffee",
    href: "https://ko-fi.com/inkedmark",
  });
}

export class InkedMarkSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InkedMarkPlugin,
  ) {
    super(app, plugin);
  }

  /**
   * Whether the Paper width field currently holds out-of-range text. Render
   * state only — the persisted setting always keeps the last valid value.
   */
  private paperWidthInvalid = false;

  /**
   * Re-render the tab on whichever settings API this Obsidian build uses.
   * On ≥ 1.13 the tab renders from `getSettingDefinitions()`, and rendering
   * the legacy layout there would paint a second, imperative copy of the UI.
   * `requireApiVersion` is the guard the plugin-review scanner recognizes for
   * calling APIs newer than minAppVersion.
   */
  refresh(): void {
    if (requireApiVersion("1.13.0")) this.update();
    else this.renderLegacy();
  }

  // -------------------------------------------------------------------------
  // Declarative settings (Obsidian ≥ 1.13). The imperative display() at the
  // bottom of this class is the fallback for older installs — when changing a
  // setting, keep both in sync.
  // -------------------------------------------------------------------------

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    const customKey = settings.llmVendor === "custom";

    const providerOptions: Record<string, string> = {};
    for (const id of this.plugin.providers.keys()) {
      if (id === TROCR_PROVIDER_ID && (!settings.experimentalTrocr || Platform.isMobileApp)) {
        continue;
      }
      providerOptions[id] = providerLabel(id);
    }

    return [
      {
        name: "",
        searchable: false,
        visible: Platform.isIosApp && Platform.isTablet,
        render: (setting) => this.renderBlock(setting, (el) => buildCallout(el, SCRIBBLE_CALLOUT)),
      },
      {
        name: "Pressure sensitivity",
        desc: "Use pen pressure to vary stroke width (pen/stylus only).",
        control: { type: "toggle", key: "pressureEnabled" },
      },
      {
        name: "Desynchronized canvas",
        desc: "Low-latency rendering hint. Turn off if ink looks corrupted on your device (historically flaky on iOS WebKit).",
        control: { type: "toggle", key: "desynchronizedCanvas" },
      },
      {
        name: "Paper width",
        desc: "Logical width of the paper roll, in pixels.",
        render: (setting) => {
          // A plain text input, not a `number` control: the number control's
          // min/max clamp keystrokes silently, so out-of-range input could
          // never reach the user as feedback.
          this.paperWidthInvalid = false;
          setting.addText((text) =>
            text.setValue(String(this.plugin.settings.paperWidth)).onChange(async (value) => {
              const parsed = Number.parseInt(value, 10);
              const valid = Number.isFinite(parsed) && parsed >= 320 && parsed <= 4096;
              this.paperWidthInvalid = !valid;
              // The callout below keys its visibility off paperWidthInvalid.
              // (The version guard only satisfies minAppVersion linting — this
              // declarative-path callback cannot run below 1.13.)
              if (requireApiVersion("1.13.0")) this.refreshDomState();
              if (valid) {
                this.plugin.settings.paperWidth = parsed;
                await this.plugin.saveSettings();
              }
            }),
          );
        },
      },
      {
        name: "",
        searchable: false,
        visible: () => this.paperWidthInvalid,
        render: (setting) =>
          this.renderBlock(setting, (el) => buildCallout(el, PAPER_WIDTH_CALLOUT)),
      },
      {
        name: "Default ink color",
        desc: "Color selected when a new ink note opens.",
        control: { type: "color", key: "defaultColor" },
      },
      {
        name: "Default tool",
        desc: "Tool selected when an ink note opens.",
        control: { type: "dropdown", key: "defaultTool", options: TOOL_LABELS },
      },
      {
        name: "Default stroke size",
        control: {
          type: "dropdown",
          key: "defaultSize",
          options: Object.fromEntries(SIZES.map((size) => [String(size), String(size)])),
        },
      },
      {
        name: "Highlighter opacity",
        desc: "Transparency of highlighter strokes.",
        control: { type: "slider", key: "highlighterAlpha", min: 10, max: 100, step: 5 },
      },
      {
        name: "Custom colors",
        desc: "Extra palette swatches, as comma-separated hex (e.g. #ff8800, #00ccaa).",
        control: { type: "text", key: "customColors", placeholder: "#ff8800, #00ccaa" },
      },
      {
        name: "Handwriting recognition",
        desc:
          "Provider that turns strokes into searchable text. Manual = you type the transcription; " +
          "Cloud AI sends an image of the ink to a vision model using your own API key.",
        control: { type: "dropdown", key: "recognitionProviderId", options: providerOptions },
      },
      {
        type: "group",
        visible: () => this.plugin.settings.recognitionProviderId === LLM_PROVIDER_ID,
        items: [
          {
            name: "Cloud AI vendor",
            control: { type: "dropdown", key: "llmVendor", options: VENDOR_LABELS },
          },
          {
            name: "Endpoint URL",
            desc:
              "OpenAI-compatible base URL, including /v1 where the server uses one — " +
              "works with Ollama, LM Studio, llama.cpp, vLLM, LocalAI. See SELF_HOSTING.md " +
              "in the plugin repository for setup guides.",
            visible: () => this.plugin.settings.llmVendor === "custom",
            render: (setting) => {
              setting.setClass("inkedmark-wide-text");
              setting.addText((text) =>
                text
                  .setPlaceholder("http://localhost:11434/v1")
                  .setValue(this.plugin.settings.llmBaseUrl)
                  .onChange(async (value) => {
                    this.plugin.settings.llmBaseUrl = value.trim();
                    // The two callouts below key their visibility off the URL.
                    if (requireApiVersion("1.13.0")) this.refreshDomState();
                    await this.plugin.saveSettings();
                  }),
              );
            },
          },
          {
            name: "",
            searchable: false,
            visible: () =>
              this.plugin.settings.llmVendor === "custom" &&
              endpointUrlInvalid(this.plugin.settings.llmBaseUrl),
            render: (setting) =>
              this.renderBlock(setting, (el) => buildCallout(el, URL_ERROR_CALLOUT)),
          },
          {
            name: "",
            searchable: false,
            visible: () => {
              const { llmVendor, llmBaseUrl } = this.plugin.settings;
              return (
                llmVendor === "custom" &&
                !endpointUrlInvalid(llmBaseUrl) &&
                isPlainHttpUrl(llmBaseUrl)
              );
            },
            render: (setting) =>
              this.renderBlock(setting, (el) => buildCallout(el, HTTP_WARNING_CALLOUT)),
          },
          {
            name: "Connect OpenRouter",
            desc:
              "One-click connect creates a user-scoped API key in your browser — no copy/paste. " +
              "You approve it on openrouter.ai; nothing is sent until you do.",
            visible: () => this.plugin.settings.llmVendor === "openrouter",
            render: (setting) => {
              setting.addButton((button) =>
                button
                  .setButtonText(
                    this.plugin.settings.llmApiKey ? "Reconnect" : "Connect OpenRouter",
                  )
                  .setCta()
                  .onClick(() => void this.plugin.startOpenRouterConnect()),
              );
            },
          },
          {
            name: "Cloud AI model",
            desc:
              `Leave empty for the default (${DEFAULT_MODELS[settings.llmVendor]}). ` +
              "Any vision-capable model id works — pick a cheaper one (e.g. claude-haiku-4-5) " +
              "if cost matters more than accuracy.",
            control: {
              type: "text",
              key: "llmModel",
              placeholder: DEFAULT_MODELS[settings.llmVendor],
            },
          },
          {
            name: customKey ? "Endpoint API key" : "Cloud AI API key",
            desc: customKey
              ? "Optional — most self-hosted servers don't need one. Kept separate from your " +
                "cloud vendor key and sent only to your configured endpoint."
              : "Your own key for the selected vendor. Stored locally in this vault's plugin data " +
                "and sent only to that vendor when you run recognition.",
            render: (setting) => {
              setting.addText(this.apiKeyText(customKey));
            },
          },
          {
            name: "Recognize automatically",
            desc:
              "Run recognition in the background about 30 seconds after you stop writing, " +
              "and only when the ink actually changed. Requires the one-time cloud consent " +
              "(run it manually once first).",
            control: { type: "toggle", key: "autoRecognize" },
          },
        ],
      },
      {
        name: "On-device recognition (experimental)",
        desc:
          "Adds an offline recognizer (TrOCR) to the provider list. Your ink never leaves " +
          "the device, but the first run downloads the model from Hugging Face. " +
          "English handwriting only, and noticeably less accurate than Cloud AI — expect " +
          "rough output on cursive. Desktop only.",
        visible: !Platform.isMobileApp,
        control: { type: "toggle", key: "experimentalTrocr" },
      },
      {
        name: "On-device model",
        desc:
          "Each model downloads once and runs locally. Fast is the quickest and least " +
          "accurate; Accurate is better but still below Cloud AI, and needs WebGPU " +
          "(a large one-time download).",
        visible: () => !Platform.isMobileApp && this.plugin.settings.experimentalTrocr,
        control: {
          type: "dropdown",
          key: "trocrModel",
          options: Object.fromEntries(
            Object.entries(TROCR_MODELS).map(([key, model]) => [key, model.label]),
          ),
        },
      },
      {
        type: "group",
        heading: "Support and diagnostics",
        items: [
          {
            name: "Input debug overlay",
            desc:
              "Show raw pen/touch event data on the canvas — event sequence, coalesced counts, " +
              "timing gaps, and stroke totals. Useful when reporting missing or broken strokes.",
            control: { type: "toggle", key: "debugHud" },
          },
          {
            name: "",
            searchable: false,
            render: (setting) => this.renderBlock(setting, buildSupportFooter),
          },
        ],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    const settings = this.plugin.settings;
    switch (key) {
      case "defaultSize":
        return String(settings.defaultSize);
      case "highlighterAlpha":
        return Math.round(settings.highlighterAlpha * 100);
      case "customColors":
        return settings.customColors.join(", ");
      default:
        return settings[key as keyof InkedMarkSettings];
    }
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings;
    switch (key) {
      case "defaultSize":
        settings.defaultSize = Number(value);
        break;
      case "highlighterAlpha":
        settings.highlighterAlpha = (value as number) / 100;
        break;
      case "customColors":
        settings.customColors = parseCustomColors(value as string);
        break;
      case "llmModel":
        settings.llmModel = (value as string).trim();
        break;
      case "llmVendor":
        settings.llmVendor = value as LlmVendor;
        // A vendor change invalidates any in-flight OpenRouter connect so a
        // stale browser approval can't overwrite this choice later.
        this.plugin.cancelOpenRouterConnect();
        break;
      case "experimentalTrocr":
        settings.experimentalTrocr = value as boolean;
        if (!value && settings.recognitionProviderId === TROCR_PROVIDER_ID) {
          settings.recognitionProviderId = MANUAL_PROVIDER_ID;
        }
        break;
      case "debugHud":
        // Saves settings itself and propagates the overlay to open ink views.
        await this.plugin.setDebugHud(value as boolean);
        return;
      default:
        (settings as unknown as Record<string, unknown>)[key] = value;
        break;
    }
    await this.plugin.saveSettings();
    // These keys change which settings exist (dropdown options, vendor
    // sections, model defaults) — rebuild the definitions, like the
    // imperative path's renderLegacy() calls.
    if (
      requireApiVersion("1.13.0") &&
      (key === "recognitionProviderId" || key === "llmVendor" || key === "experimentalTrocr")
    ) {
      this.update();
    }
  }

  /** Replace a definition row with a full-width custom block (callout/footer). */
  private renderBlock(setting: Setting, build: (parent: HTMLElement) => unknown): void {
    setting.settingEl.empty();
    setting.settingEl.addClass("inkedmark-plain-row");
    build(setting.settingEl);
  }

  /** Password-style input bound to whichever API key slot the vendor uses. */
  private apiKeyText(customKey: boolean): (text: TextComponent) => void {
    return (text) => {
      text.inputEl.type = "password";
      text
        .setPlaceholder(customKey ? "(usually empty)" : "sk-…")
        .setValue(customKey ? this.plugin.settings.llmCustomApiKey : this.plugin.settings.llmApiKey)
        .onChange(async (value) => {
          if (customKey) {
            this.plugin.settings.llmCustomApiKey = value.trim();
          } else {
            this.plugin.settings.llmApiKey = value.trim();
            // Editing the key by hand invalidates any in-flight connect.
            this.plugin.cancelOpenRouterConnect();
          }
          await this.plugin.saveSettings();
        });
    };
  }

  // -------------------------------------------------------------------------
  // Imperative fallback, used only on Obsidian < 1.13 (where
  // getSettingDefinitions is not supported). Keep in sync with the
  // declarative definitions above.
  // -------------------------------------------------------------------------

  override display(): void {
    this.renderLegacy();
  }

  private renderLegacy(): void {
    const { containerEl } = this;
    containerEl.empty();

    if (Platform.isIosApp && Platform.isTablet) {
      buildCallout(containerEl, SCRIBBLE_CALLOUT);
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

    let paperWidthCallout: HTMLDivElement | null = null;
    new Setting(containerEl)
      .setName("Paper width")
      .setDesc("Logical width of the paper roll, in pixels.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.paperWidth)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          const valid = Number.isFinite(parsed) && parsed >= 320 && parsed <= 4096;
          paperWidthCallout?.toggle(!valid);
          if (valid) {
            this.plugin.settings.paperWidth = parsed;
            await this.plugin.saveSettings();
          }
        }),
      );
    paperWidthCallout = buildCallout(containerEl, PAPER_WIDTH_CALLOUT);
    paperWidthCallout.toggle(false);

    new Setting(containerEl)
      .setName("Default ink color")
      .setDesc("Color selected when a new ink note opens.")
      .addColorPicker((picker) =>
        picker.setValue(this.plugin.settings.defaultColor).onChange(async (value) => {
          this.plugin.settings.defaultColor = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Default tool")
      .setDesc("Tool selected when an ink note opens.")
      .addDropdown((dropdown) => {
        for (const [id, label] of Object.entries(TOOL_LABELS)) dropdown.addOption(id, label);
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
            this.plugin.settings.customColors = parseCustomColors(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Handwriting recognition")
      .setDesc(
        "Provider that turns strokes into searchable text. Manual = you type the transcription; " +
          "Cloud AI sends an image of the ink to a vision model using your own API key.",
      )
      .addDropdown((dropdown) => {
        for (const id of this.plugin.providers.keys()) {
          if (
            id === TROCR_PROVIDER_ID &&
            (!this.plugin.settings.experimentalTrocr || Platform.isMobileApp)
          )
            continue;
          dropdown.addOption(id, providerLabel(id));
        }
        dropdown.setValue(this.plugin.settings.recognitionProviderId).onChange(async (value) => {
          this.plugin.settings.recognitionProviderId = value;
          await this.plugin.saveSettings();
          this.renderLegacy(); // re-render so the Cloud AI fields appear/disappear
        });
      });

    if (this.plugin.settings.recognitionProviderId === LLM_PROVIDER_ID) {
      new Setting(containerEl).setName("Cloud AI vendor").addDropdown((dropdown) => {
        for (const [id, label] of Object.entries(VENDOR_LABELS)) dropdown.addOption(id, label);
        dropdown.setValue(this.plugin.settings.llmVendor).onChange(async (value) => {
          this.plugin.settings.llmVendor = value as LlmVendor;
          // A vendor change invalidates any in-flight OpenRouter connect so a
          // stale browser approval can't overwrite this choice later.
          this.plugin.cancelOpenRouterConnect();
          await this.plugin.saveSettings();
          this.renderLegacy(); // refresh the model placeholder
        });
      });

      if (this.plugin.settings.llmVendor === "custom") {
        let urlError: HTMLDivElement | null = null;
        let httpWarning: HTMLDivElement | null = null;
        const refreshEndpointCallouts = () => {
          const url = this.plugin.settings.llmBaseUrl;
          const invalid = endpointUrlInvalid(url);
          urlError?.toggle(invalid);
          httpWarning?.toggle(!invalid && isPlainHttpUrl(url));
        };
        new Setting(containerEl)
          .setName("Endpoint URL")
          .setClass("inkedmark-wide-text")
          .setDesc(
            "OpenAI-compatible base URL, including /v1 where the server uses one — " +
              "works with Ollama, LM Studio, llama.cpp, vLLM, LocalAI. See SELF_HOSTING.md " +
              "in the plugin repository for setup guides.",
          )
          .addText((text) =>
            text
              .setPlaceholder("http://localhost:11434/v1")
              .setValue(this.plugin.settings.llmBaseUrl)
              .onChange(async (value) => {
                this.plugin.settings.llmBaseUrl = value.trim();
                refreshEndpointCallouts();
                await this.plugin.saveSettings();
              }),
          );
        urlError = buildCallout(containerEl, URL_ERROR_CALLOUT);
        httpWarning = buildCallout(containerEl, HTTP_WARNING_CALLOUT);
        refreshEndpointCallouts();
      }

      if (this.plugin.settings.llmVendor === "openrouter") {
        new Setting(containerEl)
          .setName("Connect OpenRouter")
          .setDesc(
            "One-click connect creates a user-scoped API key in your browser — no copy/paste. " +
              "You approve it on openrouter.ai; nothing is sent until you do.",
          )
          .addButton((button) =>
            button
              .setButtonText(this.plugin.settings.llmApiKey ? "Reconnect" : "Connect OpenRouter")
              .setCta()
              .onClick(() => void this.plugin.startOpenRouterConnect()),
          );
      }

      new Setting(containerEl)
        .setName("Cloud AI model")
        .setDesc(
          `Leave empty for the default (${DEFAULT_MODELS[this.plugin.settings.llmVendor]}). ` +
            "Any vision-capable model id works — pick a cheaper one (e.g. claude-haiku-4-5) " +
            "if cost matters more than accuracy.",
        )
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_MODELS[this.plugin.settings.llmVendor])
            .setValue(this.plugin.settings.llmModel)
            .onChange(async (value) => {
              this.plugin.settings.llmModel = value.trim();
              await this.plugin.saveSettings();
            }),
        );

      // The custom endpoint has its own key slot so a cloud vendor secret is
      // never sent to an arbitrary user-configured URL.
      const customKey = this.plugin.settings.llmVendor === "custom";
      new Setting(containerEl)
        .setName(customKey ? "Endpoint API key" : "Cloud AI API key")
        .setDesc(
          customKey
            ? "Optional — most self-hosted servers don't need one. Kept separate from your " +
                "cloud vendor key and sent only to your configured endpoint."
            : "Your own key for the selected vendor. Stored locally in this vault's plugin data " +
                "and sent only to that vendor when you run recognition.",
        )
        .addText(this.apiKeyText(customKey));

      new Setting(containerEl)
        .setName("Recognize automatically")
        .setDesc(
          "Run recognition in the background about 30 seconds after you stop writing, " +
            "and only when the ink actually changed. Requires the one-time cloud consent " +
            "(run it manually once first).",
        )
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.autoRecognize).onChange(async (value) => {
            this.plugin.settings.autoRecognize = value;
            await this.plugin.saveSettings();
          }),
        );
    }

    if (!Platform.isMobileApp) this.displayTrocrSettings(containerEl);

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

    buildSupportFooter(containerEl);
  }

  /** On-device recognition settings (desktop only; mobile webviews can't run the models). */
  private displayTrocrSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("On-device recognition (experimental)")
      .setDesc(
        "Adds an offline recognizer (TrOCR) to the provider list. Your ink never leaves " +
          "the device, but the first run downloads the model from Hugging Face. " +
          "English handwriting only, and noticeably less accurate than Cloud AI — expect " +
          "rough output on cursive. Desktop only.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.experimentalTrocr).onChange(async (value) => {
          this.plugin.settings.experimentalTrocr = value;
          if (!value && this.plugin.settings.recognitionProviderId === TROCR_PROVIDER_ID) {
            this.plugin.settings.recognitionProviderId = MANUAL_PROVIDER_ID;
          }
          await this.plugin.saveSettings();
          this.renderLegacy();
        }),
      );

    if (this.plugin.settings.experimentalTrocr) {
      new Setting(containerEl)
        .setName("On-device model")
        .setDesc(
          "Each model downloads once and runs locally. Fast is the quickest and least " +
            "accurate; Accurate is better but still below Cloud AI, and needs WebGPU " +
            "(a large one-time download).",
        )
        .addDropdown((dropdown) => {
          for (const [key, model] of Object.entries(TROCR_MODELS)) {
            dropdown.addOption(key, model.label);
          }
          dropdown.setValue(this.plugin.settings.trocrModel).onChange(async (value) => {
            this.plugin.settings.trocrModel = value as TrocrSize;
            await this.plugin.saveSettings();
          });
        });
    }
  }
}
