/**
 * Recognition provider registry (§7, §10). v1 ships only {@link ManualProvider};
 * this is the extensibility seam — a future HWR provider registers by id and the
 * user selects it via `settings.recognitionProviderId`.
 *
 * No DOM, no Obsidian.
 */

import type { RecognitionProvider } from "./provider";
import { MANUAL_PROVIDER_ID, ManualProvider } from "./manual";
import { LLM_PROVIDER_ID } from "./llm-request";

export function createProviderRegistry(): Map<string, RecognitionProvider> {
  const registry = new Map<string, RecognitionProvider>();
  const manual = new ManualProvider();
  registry.set(manual.id, manual);
  return registry;
}

/** The provider for `id`, falling back to the manual (no-op) provider. */
export function resolveProvider(
  registry: Map<string, RecognitionProvider>,
  id: string,
): RecognitionProvider {
  return registry.get(id) ?? registry.get(MANUAL_PROVIDER_ID) ?? new ManualProvider();
}

/** A human label for a provider id (for the settings dropdown). */
export function providerLabel(id: string): string {
  if (id === MANUAL_PROVIDER_ID) return "Manual (type the transcription yourself)";
  if (id === LLM_PROVIDER_ID) return "Cloud AI (bring your own key)";
  return id;
}
