/**
 * Default v1 provider: no automatic recognition. The user authors the text
 * layer by hand; this returns an empty result so callers have a uniform path.
 */

import type { RecognitionProvider, RecognitionResult } from "./provider";

export const MANUAL_PROVIDER_ID = "manual";

export class ManualProvider implements RecognitionProvider {
  readonly id = MANUAL_PROVIDER_ID;
  readonly requiresNetwork = false;

  recognize(): Promise<RecognitionResult> {
    return Promise.resolve({ text: "", confidence: 0 });
  }
}
