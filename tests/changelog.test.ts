import { describe, expect, it } from "vitest";
import {
  changelogSince,
  compareVersions,
  parseChangelogSections,
  releasedChangelog,
} from "../src/changelog";

const CHANGELOG = `# Changelog

All notable changes are documented here.

## [Unreleased]

### Changed

- Something in flight.

## [1.1.0] - 2026-07-05

Self-hosted recognition.

### Added

- Custom endpoint vendor.

## [1.0.2] - 2026-07-03

- Review fixes.

## [1.0.0] - 2026-06-30

- Initial release.
`;

describe("parseChangelogSections", () => {
  it("returns released sections newest first, with headings", () => {
    const sections = parseChangelogSections(CHANGELOG);
    expect(sections.map((s) => s.version)).toEqual(["1.1.0", "1.0.2", "1.0.0"]);
    expect(sections[0].markdown).toContain("## [1.1.0] - 2026-07-05");
    expect(sections[0].markdown).toContain("Custom endpoint vendor.");
  });

  it("skips the preamble and the Unreleased section", () => {
    const all = parseChangelogSections(CHANGELOG)
      .map((s) => s.markdown)
      .join("\n");
    expect(all).not.toContain("Something in flight");
    expect(all).not.toContain("All notable changes");
  });

  it("keeps sub-headings inside a section", () => {
    const [latest] = parseChangelogSections(CHANGELOG);
    expect(latest.markdown).toContain("### Added");
  });

  it("handles an empty or heading-free document", () => {
    expect(parseChangelogSections("")).toEqual([]);
    expect(parseChangelogSections("no headings here")).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("orders by major, minor, patch numerically", () => {
    expect(compareVersions("1.1.0", "1.0.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("changelogSince", () => {
  it("returns every section newer than the given version", () => {
    const md = changelogSince(CHANGELOG, "1.0.0");
    expect(md).toContain("[1.1.0]");
    expect(md).toContain("[1.0.2]");
    expect(md).not.toContain("[1.0.0]");
  });

  it("returns nothing when already on the newest version", () => {
    expect(changelogSince(CHANGELOG, "1.1.0")).toBe("");
  });

  it("returns nothing when the seen version is newer (downgrade/sync)", () => {
    expect(changelogSince(CHANGELOG, "2.0.0")).toBe("");
  });

  it("falls back to only the newest section without a usable version", () => {
    for (const since of [null, "", "garbage"]) {
      const md = changelogSince(CHANGELOG, since);
      expect(md).toContain("[1.1.0]");
      expect(md).not.toContain("[1.0.2]");
    }
  });
});

describe("releasedChangelog", () => {
  it("joins all released sections and strips Unreleased", () => {
    const md = releasedChangelog(CHANGELOG);
    expect(md).toContain("[1.1.0]");
    expect(md).toContain("[1.0.0]");
    expect(md).not.toContain("Unreleased");
  });
});
