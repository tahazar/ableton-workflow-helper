# vendor/

Third-party artifacts that must not be committed.

## ableton-sdk/ (gitignored)

Place the extracted Ableton Extensions SDK zip (from Ableton's beta program /
Centercode) here, then run `pnpm setup:sdk` from the repo root. The SDK is
non-redistributable and must never be committed or pushed (enforced by
.gitignore; see ADR-001/ADR-002).
