import { describe, expect, it } from "vitest";
import {
  createProviderRegistry,
  providerLabel,
  resolveProvider,
} from "../../src/recognition/registry";
import { MANUAL_PROVIDER_ID } from "../../src/recognition/manual";

describe("recognition registry", () => {
  it("registers the manual provider by default", () => {
    const registry = createProviderRegistry();
    expect(registry.has(MANUAL_PROVIDER_ID)).toBe(true);
    expect(registry.get(MANUAL_PROVIDER_ID)?.requiresNetwork).toBe(false);
  });

  it("resolves a known id", () => {
    const registry = createProviderRegistry();
    expect(resolveProvider(registry, MANUAL_PROVIDER_ID).id).toBe(MANUAL_PROVIDER_ID);
  });

  it("falls back to manual for an unknown id", () => {
    const registry = createProviderRegistry();
    expect(resolveProvider(registry, "does-not-exist").id).toBe(MANUAL_PROVIDER_ID);
  });

  it("manual provider recognizes to empty text", async () => {
    const registry = createProviderRegistry();
    const result = await resolveProvider(registry, MANUAL_PROVIDER_ID).recognize({ strokes: [] });
    expect(result).toEqual({ text: "", confidence: 0 });
  });

  it("labels the manual provider", () => {
    expect(providerLabel(MANUAL_PROVIDER_ID)).toMatch(/manual/i);
    expect(providerLabel("future-hwr")).toBe("future-hwr");
  });
});
