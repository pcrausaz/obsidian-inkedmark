import {
  type Editor,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFile,
  type ViewState,
  WorkspaceLeaf,
  normalizePath,
  requestUrl,
} from "obsidian";
import {
  FRONTMATTER_FLAG,
  INK_FILE_SUFFIX,
  SCHEMA_VERSION,
  TROCR_PROVIDER_ID,
  VIEW_TYPE_INK,
} from "./constants";
import { DEFAULT_SETTINGS, InkedMarkSettingTab, type InkedMarkSettings } from "./settings";
import { ICON_INK_NOTE, registerIcons } from "./icons";
import { emptyDocument } from "./model/document";
import { buildInkFile, encodeDocument } from "./model/serialize";
import { buildInlineBlock } from "./model/inline-block";
import type { RecognitionProvider } from "./recognition/provider";
import { createProviderRegistry, resolveProvider } from "./recognition/registry";
import { MANUAL_PROVIDER_ID } from "./recognition/manual";
import { LlmProvider } from "./recognition/llm";
import { TrocrProvider } from "./recognition/trocr";
import { describeLlmTarget } from "./recognition/llm-request";
import {
  OPENROUTER_CALLBACK_ACTION,
  buildKeyExchangeRequest,
  buildOpenRouterAuthUrl,
  codeChallenge,
  extractOpenRouterKey,
  generateCodeVerifier,
} from "./recognition/openrouter-auth";
import { ConfirmModal } from "./ui/confirm-modal";
import { InkView } from "./view/ink-view";
import { registerInkEmbeds } from "./view/embed-processor";

export default class InkedMarkPlugin extends Plugin {
  override settings!: InkedMarkSettings;
  readonly providers = createProviderRegistry();

  /**
   * PKCE verifier for an in-flight OpenRouter connect. Kept in memory only —
   * persisting it would sync a secret across devices and leave stale secrets
   * behind on cancel. If Obsidian is evicted mid-flow, the user just clicks
   * Connect again.
   */
  private pendingOpenRouterVerifier: string | null = null;
  private settingTab: InkedMarkSettingTab | null = null;

  /**
   * Ink files the user explicitly toggled to the markdown view. Without this,
   * `switchInkLeaves` (on layout-change) would immediately flip a toggled leaf
   * back to the ink view, making the toggle command a no-op.
   */
  private readonly markdownOverride = new Set<string>();

  /** The recognition provider selected in settings (manual in v1). */
  activeProvider(): RecognitionProvider {
    // Synced settings can select the on-device provider on a device that can't
    // run it (mobile webviews); fall back to manual there.
    const id =
      Platform.isMobileApp && this.settings.recognitionProviderId === TROCR_PROVIDER_ID
        ? MANUAL_PROVIDER_ID
        : this.settings.recognitionProviderId;
    return resolveProvider(this.providers, id);
  }

  override async onload(): Promise<void> {
    await this.loadSettings();
    registerIcons();

    const llm = new LlmProvider(() => ({
      vendor: this.settings.llmVendor,
      model: this.settings.llmModel,
      apiKey: this.settings.llmApiKey,
      baseUrl: this.settings.llmBaseUrl,
    }));
    this.providers.set(llm.id, llm);

    const trocr = new TrocrProvider(() => ({ size: this.settings.trocrModel }));
    this.providers.set(trocr.id, trocr);

    this.registerView(VIEW_TYPE_INK, (leaf) => new InkView(leaf, this));
    this.installViewStatePatch();
    registerInkEmbeds(this);

    this.addRibbonIcon(ICON_INK_NOTE, "Create handwriting note", () => {
      void this.createInkNote();
    });

    this.addCommand({
      id: "create-handwriting-note",
      name: "Create handwriting note",
      callback: () => void this.createInkNote(),
    });

    this.addCommand({
      id: "toggle-canvas-markdown-view",
      name: "Toggle canvas / markdown view",
      checkCallback: (checking) => {
        const view =
          this.app.workspace.getActiveViewOfType(InkView) ??
          this.app.workspace.getActiveViewOfType(MarkdownView);
        const eligible = !!view?.file && (view instanceof InkView || this.isInkFile(view.file));
        if (eligible && !checking && view) void this.toggleView(view.leaf);
        return eligible;
      },
    });

    this.addCommand({
      id: "insert-inline-handwriting",
      name: "Insert inline handwriting",
      editorCallback: (editor: Editor) => {
        const payload = encodeDocument(emptyDocument(this.settings.paperWidth));
        editor.replaceSelection(buildInlineBlock(payload));
      },
    });

    this.addCommand({
      id: "toggle-text-layer",
      name: "Toggle text layer panel",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.toggleTextPanel();
        return !!view;
      },
    });

    this.addCommand({
      id: "recognize-handwriting",
      name: "Recognize handwriting in this note",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) void this.runRecognition(view);
        return !!view;
      },
    });

    this.addCommand({
      id: "fit-reset-view",
      name: "Fit / reset view",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.resetView();
        return !!view;
      },
    });

    this.addCommand({
      id: "zoom-in",
      name: "Zoom in",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.zoomIn();
        return !!view;
      },
    });

    this.addCommand({
      id: "zoom-out",
      name: "Zoom out",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.zoomOut();
        return !!view;
      },
    });

    this.addCommand({
      id: "toggle-input-debug-overlay",
      name: "Toggle input debug overlay",
      callback: () => void this.toggleDebugHud(),
    });

    // Swap the markdown view for the ink view whenever an ink file is shown.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.switchInkLeaves()));
    this.app.workspace.onLayoutReady(() => this.switchInkLeaves());

    this.settingTab = new InkedMarkSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Receives the browser redirect at the end of the OpenRouter connect flow.
    this.registerObsidianProtocolHandler(OPENROUTER_CALLBACK_ACTION, (params) => {
      void this.handleOpenRouterCallback(params);
    });
  }

  override onunload(): void {
    // Leaves of VIEW_TYPE_INK are detached automatically by Obsidian.
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<InkedMarkSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * One-time iPad notice: iPadOS Scribble intercepts fast Pencil strokes before
   * the web view sees them. We can't disable it from a plugin (it's a native
   * system feature), so we point the user at the setting. Shown once, on first
   * ink-note open on an iPad.
   */
  async maybeShowScribbleNotice(): Promise<void> {
    if (!Platform.isIosApp || !Platform.isTablet) return;
    if (this.settings.scribbleNoticeShown) return;
    this.settings.scribbleNoticeShown = true;
    await this.saveSettings();
    new Notice(
      "InkedMark tip: if handwriting drops strokes on iPad, turn off " +
        "Settings → Apple Pencil → Scribble. iPadOS intercepts fast Pencil " +
        "strokes before InkedMark can see them.",
      0,
    );
  }

  /**
   * Run recognition on a view, asking for one-time consent before the first
   * cloud call (cloud providers send a rendered image of the ink off-device).
   * Background (`auto`) runs never prompt — without consent they just skip.
   */
  async runRecognition(view: InkView, auto = false): Promise<void> {
    const provider = this.activeProvider();
    if (provider.requiresNetwork && !this.settings.cloudConsentGiven) {
      if (auto) return;
      const target = describeLlmTarget(this.settings.llmVendor, this.settings.llmBaseUrl);
      const custom = this.settings.llmVendor === "custom";
      const confirmed = await ConfirmModal.confirm(this.app, {
        title: custom
          ? "Send handwriting to your endpoint?"
          : "Send handwriting to a cloud service?",
        message:
          `Cloud recognition renders this note's ink into an image and sends it to ${target}` +
          (custom
            ? ". If that server is yours, the ink stays under your control. "
            : " using your API key. The ink leaves your device for that request only. ") +
          "This choice is remembered; the manual provider never uses the network.",
        cta: "Send",
      });
      if (!confirmed) return;
      this.settings.cloudConsentGiven = true;
      await this.saveSettings();
    }
    await view.recognize(provider, auto);
  }

  /** Begin the OpenRouter one-click connect: open the approval page in the browser. */
  async startOpenRouterConnect(): Promise<void> {
    const verifier = generateCodeVerifier();
    this.pendingOpenRouterVerifier = verifier;
    window.open(buildOpenRouterAuthUrl(await codeChallenge(verifier)));
  }

  /** Finish the connect flow: trade the browser-redirect code for a user-scoped API key. */
  async handleOpenRouterCallback(params: Record<string, string>): Promise<void> {
    if (!params.code) {
      new Notice("OpenRouter connection failed — no code returned.");
      return;
    }
    const verifier = this.pendingOpenRouterVerifier;
    if (!verifier) {
      new Notice("No pending OpenRouter connection — open settings and click Connect again.");
      return;
    }
    this.pendingOpenRouterVerifier = null;

    const request = buildKeyExchangeRequest(params.code, verifier);
    let response;
    try {
      response = await requestUrl({
        url: request.url,
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        throw: false,
      });
    } catch {
      new Notice("Could not reach openrouter.ai — check your connection and try again.");
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      new Notice(`OpenRouter key exchange failed (HTTP ${response.status}).`);
      return;
    }

    let key = "";
    try {
      key = extractOpenRouterKey(response.json);
    } catch {
      // unreadable response body; fall through to the no-key notice
    }
    if (!key) {
      new Notice("OpenRouter returned no API key — try connecting again.");
      return;
    }

    this.settings.llmApiKey = key;
    // Defensive: the vendor dropdown may have changed while the browser was open.
    this.settings.llmVendor = "openrouter";
    await this.saveSettings();
    new Notice("OpenRouter connected.");
    // Refresh the settings tab if it is currently visible.
    if (this.settingTab?.containerEl.isConnected) this.settingTab.display();
  }

  /** Turn the input debug overlay on/off everywhere (settings toggle + command). */
  async setDebugHud(enabled: boolean, notify = false): Promise<void> {
    this.settings.debugHud = enabled;
    await this.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_INK)) {
      if (leaf.view instanceof InkView) leaf.view.setDebug(enabled);
    }
    if (notify) new Notice(`InkedMark input debug overlay ${enabled ? "on" : "off"}`);
  }

  private async toggleDebugHud(): Promise<void> {
    await this.setDebugHud(!this.settings.debugHud, true);
  }

  // --- Ink-file detection & view switching ----------------------------------

  /**
   * Intercept `WorkspaceLeaf.setViewState` so an ink file *instantiates* as the
   * ink view instead of being opened as markdown and flipped afterwards. The
   * after-the-fact flip (on layout-change) fought Obsidian's navigation history:
   * pressing Back landed on the intermediate markdown state, which we instantly
   * flipped again — eating the Back press. Patching at the state level means no
   * markdown state ever enters history. Same approach as Kanban/Excalidraw;
   * the original method is restored on unload.
   */
  private installViewStatePatch(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the patched function needs the leaf's `this` AND the plugin instance
    const plugin = this;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured to delegate via .call(leaf, ...) and to restore on unload
    const original = WorkspaceLeaf.prototype.setViewState;
    WorkspaceLeaf.prototype.setViewState = function (
      this: WorkspaceLeaf,
      viewState: ViewState,
      eState?: unknown,
    ) {
      if (viewState.type === "markdown") {
        const path = viewState.state?.file;
        if (typeof path === "string" && !plugin.markdownOverride.has(path)) {
          const file = plugin.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile && plugin.isInkFile(file)) {
            viewState = { ...viewState, type: VIEW_TYPE_INK };
          }
        }
      }
      return original.call(this, viewState, eState);
    };
    this.register(() => {
      WorkspaceLeaf.prototype.setViewState = original;
    });
  }

  isInkFile(file: TFile): boolean {
    if (file.extension !== "md") return false;
    if (file.name.endsWith(INK_FILE_SUFFIX)) return true;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return !!frontmatter && frontmatter[FRONTMATTER_FLAG] === true;
  }

  private activeFile(leaf: WorkspaceLeaf | null): TFile | null {
    const view = leaf?.view;
    if (view instanceof MarkdownView || view instanceof InkView) return view.file;
    return null;
  }

  private switchInkLeaves(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) continue;
      if (!this.isInkFile(view.file)) continue;
      if (this.markdownOverride.has(view.file.path)) continue;
      void this.setLeafViewType(leaf, VIEW_TYPE_INK, view.file);
    }
  }

  private async setLeafViewType(leaf: WorkspaceLeaf, type: string, file: TFile): Promise<void> {
    const existing = leaf.getViewState();
    await leaf.setViewState({
      ...existing,
      type,
      state: { ...existing.state, file: file.path, mode: "source" },
      active: existing.active,
    });
  }

  private async toggleView(leaf: WorkspaceLeaf): Promise<void> {
    const file = this.activeFile(leaf);
    if (!file) return;
    const toMarkdown = leaf.view instanceof InkView;
    if (toMarkdown) this.markdownOverride.add(file.path);
    else this.markdownOverride.delete(file.path);
    await this.setLeafViewType(leaf, toMarkdown ? "markdown" : VIEW_TYPE_INK, file);
  }

  // --- New note -------------------------------------------------------------

  private async createInkNote(): Promise<void> {
    const path = await this.uniqueInkPath();
    const basename = path.slice(path.lastIndexOf("/") + 1, -INK_FILE_SUFFIX.length);
    const created = new Date().toISOString();
    const body =
      `---\n` +
      `${FRONTMATTER_FLAG}: true\n` +
      `inkedmark-version: ${SCHEMA_VERSION}\n` +
      `created: ${created}\n` +
      `modified: ${created}\n` +
      `---\n\n` +
      `# ${basename}\n`;
    const content = buildInkFile(body, emptyDocument(this.settings.paperWidth));

    const file = await this.app.vault.create(path, content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_INK, state: { file: file.path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async uniqueInkPath(): Promise<string> {
    const activeFile = this.app.workspace.getActiveFile();
    const folder =
      activeFile?.parent?.path && activeFile.parent.path !== "/" ? activeFile.parent.path : "";
    const base = "Handwriting note";
    for (let i = 0; ; i++) {
      const name = i === 0 ? `${base}${INK_FILE_SUFFIX}` : `${base} ${i}${INK_FILE_SUFFIX}`;
      const path = normalizePath(folder ? `${folder}/${name}` : name);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
  }
}
