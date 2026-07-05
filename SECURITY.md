# Security policy

## Supported versions

Only the latest release of InkedMark receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub — **Security → Report a
vulnerability** on this repository — or by email to support@inkedmark.com.
Do not open a public issue for security problems. Include reproduction
steps and the platform involved (desktop or iOS/iPadOS); you should hear
back within a few days.

## Notes for reviewers

- API keys for the optional cloud recognition providers are stored in
  plaintext in the vault's plugin data (`data.json`). This is documented in
  the README; protecting the vault itself is the user's responsibility.
- The plugin makes network requests only for recognition and the optional
  OpenRouter connect flow, exactly as itemized in the README's
  "Network use disclosure" section. There is no telemetry.
- Release artifacts carry GitHub build-provenance attestations; verify with
  `gh attestation verify main.js --repo pcrausaz/obsidian-inkedmark`.
