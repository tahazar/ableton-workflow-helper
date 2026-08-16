# Design: Clip Library + Knowledge Base (B3/B4)

- Status: requirements agreed (owner interview 2026-08-17); backlog features
  B3/B4 in `docs/spec.md`
- Goal: a git-versioned, continuously growing memory for the owner's musical
  material and production knowledge — so Claude works from ACCURATE REFERENCES
  instead of re-reasoning from scratch every session (owner's determinism
  principle), and so good material from one project is one command away in the
  next.

## Decisions (from owner interview)

| Question | Decision |
|---|---|
| Where does it live | THIS repo: `library/` (assets) + `knowledge/` (wiki). Git-versioned, available to local and remote sessions, one clone has everything |
| What a saved clip captures | Notes + context: bar|beat notation, tempo/scale/length, tags, source project reference. Device chains as separate param-snapshot recipes. Audio clips reference sample paths — no media copies in git |
| Trust model | Tiered + executable-first: every entry carries runnable artifacts where possible; tier ∈ `verified` (owner tested in Live) / `sourced` (distilled from citable reference) / `draft` (Claude-proposed, untested). Claude states the tier when it uses an entry |
| Capture surfaces | ALL of: right-click in Live, CLI/Claude command, and batch project distillation |

## Formats (markdown + YAML frontmatter: grep-able, git-diffable, LLM-native)

### Library clip — `library/clips/<category>/<slug>.md`

```markdown
---
slug: rolling-garage-hats-1
kind: midi
category: hats
tags: [garage, shuffle, 2step, hats]
bpm: 132
scale: null            # or "C minor" when pitched
lengthBeats: 4
source: { project: "song-x.als", path: "track:3/slot:2", saved: 2026-08-17 }
tier: verified
---
# Rolling garage hats

​```awh-notation
1|1 F#1 1/4 v90
1|1.75 F#1 1/4 v60
1|2.5 F#1 1/4 v100 p85
...
​```

Swung 16ths with the "and" pushed late; velocity dip on the offbeats is what
makes it roll. Pairs with `library/recipes/crisp-hat-chain.md`.
```

The notation block is EXECUTABLE: `awh lib place rolling-garage-hats-1
track:2/slot:0` parses it and writes the clip (scale/tempo of the current Set
respected; `--transpose-to-scale` optional).

### Device-chain recipe — `library/recipes/<slug>.md`

Frontmatter (tags, source, tier) + an executable JSON block: ordered device
list with param snapshots (from `device.get`, raw values + recorded display
values where known), applied via `device.insert` + `device.param`. Limits
documented per ADR-001: stock devices only, VST chains recorded descriptively
(name + manual settings prose) but not auto-appliable.

### Knowledge entry — `knowledge/<topic>/<slug>.md`

```markdown
---
slug: garage-hat-shuffle
topic: rhythm/garage
tier: sourced
tags: [garage, 2step, swing, hats]
sources: ["<article/video url>", "own analysis of <track>"]
related: [library/clips/hats/rolling-garage-hats-1]
---
# Garage hat shuffle

## Executable
- pipeline: `swing:grid=0.25,amount=0.7 velocity-shape:mode=accent thin:keep=0.8`
- example pattern: (bar|beat block)

## The rule
16th swing 60-70%, accents on 1 and 2.5, ghost the offbeats ~30 velocity
below accents. Skip hats under the snare on 2 and 4 — that's the 2-step hole.
```

The `## Executable` section is the contract: whenever knowledge CAN be
expressed as notation, a pipeline spec, or a recipe, it MUST be — prose alone
is a last resort. This is what keeps the KB deterministic instead of vibes.

## Command surface (all buildable on existing gateway ops)

```
awh save <clipPath> --as <slug> --category hats --tags garage,shuffle
                                   # capture notes+context from the open Set
awh chain save <trackOrDevicePath> --as <slug>   # device-chain recipe
awh lib list [--tags ...] [--category ...]        # browse
awh lib show <slug>                               # print entry
awh lib place <slug> <target> [--arrange --at-bar N] [--transpose-to-scale]
awh lib index                                     # regenerate INDEX.md files
awh distill                    # batch: walk the OPEN project, Claude-guided
                               # capture of notable clips + chains + a project
                               # summary note (knowledge/projects/<name>.md)
```

## Right-click capture (extension sandbox constraint)

The extension cannot write into the repo (file access is limited to its
storage/temp dirs — pre-announced OS sandbox). Design: an **outbox**.

1. Context-menu "AWH: Save clip to library" (AudioClip + MidiClip scopes) →
   handler captures the full clip payload and appends it to an in-extension
   outbox (persisted in `storageDirectory`).
2. New gateway op `library.outbox` returns + clears pending entries.
3. `awh lib import` (run any time; the skill runs it at session start) drains
   the outbox into `library/inbox/` files for naming/tagging/tier-assignment —
   quick capture mid-session, curation later. v1 is zero-dialog (auto-slug);
   a name/tags webview dialog is a later nicety.

## Knowledge lifecycle

- **Seeding**: research agents distill external sources (genre tropes, sound
  design recipes, artist techniques) into `sourced` entries with citations —
  batched, reviewable PRs. Owner requests: "distill how <artist> does <x>".
- **From own work**: `awh distill` + "save what we learned today" at session
  end → `draft`/`verified` entries.
- **Promotion**: owner (or a Live-validated session) bumps `draft` → `verified`
  after real use. Tier changes are ordinary git diffs.
- **Retrieval**: the `awh` skill instructs Claude to grep `knowledge/` +
  `library/` INDEX files before genre/technique tasks and to cite slug + tier
  when applying an entry ("using garage-hat-shuffle [sourced]").
- "Emulate my hi-hat chain from song X" = `awh lib place` (clip) +
  `awh chain apply` (recipe) — both resolved by search over the owner's own
  captured material.

## Out of scope (recorded so they don't creep in silently)

- No embedding/vector search until grep + tags demonstrably fail at scale.
- No audio media in git (references only); no automatic scraping pipelines —
  distillation is always an explicit request with cited sources.
- VST internals in recipes stay descriptive (ADR-001 constraint).
