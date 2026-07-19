/**
 * Pure parsing of CHANGELOG.md (Keep a Changelog layout) for the in-app
 * "What's new" modal. No Obsidian/DOM imports.
 */

export interface ChangelogSection {
  version: string;
  /** The full section markdown, including its `## [x.y.z] - date` heading. */
  markdown: string;
}

/** Matches a released section heading, e.g. `## [1.1.0] - 2026-07-05`. */
const SECTION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;

const VERSION = /^\d+\.\d+\.\d+$/;

/** Released sections in file order (newest first). Skips `[Unreleased]`. */
export function parseChangelogSections(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: { version: string; lines: string[] } | null = null;
  const push = () => {
    if (current) {
      sections.push({ version: current.version, markdown: current.lines.join("\n").trim() });
      current = null;
    }
  };
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      push();
      const match = SECTION_HEADING.exec(line);
      if (match) current = { version: match[1], lines: [line] };
    } else {
      current?.lines.push(line);
    }
  }
  push();
  return sections;
}

/** Numeric x.y.z compare (releases carry no prerelease tags). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Markdown of every released section newer than `sinceVersion`, newest first.
 * Without a usable `sinceVersion` (first run of a build that tracks it), only
 * the newest section is returned — dumping the whole history at a user who
 * just updated would bury the news. Returns "" when there is nothing to show.
 */
export function changelogSince(markdown: string, sinceVersion: string | null): string {
  const sections = parseChangelogSections(markdown);
  const fresh =
    sinceVersion && VERSION.test(sinceVersion)
      ? sections.filter((s) => compareVersions(s.version, sinceVersion) > 0)
      : sections.slice(0, 1);
  return fresh.map((s) => s.markdown).join("\n\n");
}

/** The full released changelog (preamble and `[Unreleased]` stripped). */
export function releasedChangelog(markdown: string): string {
  return parseChangelogSections(markdown)
    .map((s) => s.markdown)
    .join("\n\n");
}
