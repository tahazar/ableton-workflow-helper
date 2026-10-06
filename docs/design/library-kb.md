# Design: Clip Library + Knowledge Base (B3/B4)

- Status: requirements agreed (owner interview 2026-08-17); backlog features
  B3/B4 in `docs/spec.md`.
- Goal: a git-versioned, growing memory for the owner's musical material and
  production knowledge. The agent works from accurate references instead of
  re-reasoning from scratch each time (owner's determinism principle), and
  good material from one project is one command away in the next.

## Decisions (from owner interview)

| Question | Decision |
|---|---|
| Where does it live | This repo: `library/` (assets) + `knowledge/` (wiki). Git-versioned, available to local and remote machines; one clone has everything |
| What a saved clip captures | Notes + context: bar\|beat notation, tempo/scale/length, tags, source project reference. Device chains as separate param-snapshot recipes. Audio clips reference sample paths; no media copies in git |
| Trust model | Tiered + executable-first: every entry carries runnable artifacts where possible; tier ∈ `verified` (owner tested in Live) / `sourced` (distilled from citable reference) / `draft` (agent-proposed, untested). The agent states the tier when it uses an entry |
| Capture surfaces | All of: right-click in Live, CLI/agent command, and batch project distillation |

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


The notation block is executable: `awh lib place rolling-garage-hats-1
track:2/slot:0` parses it and writes the clip (scale/tempo of the current Set
respected; `--transpose-to-scale` optional).

### Device-chain recipe — `library/recipes/<slug>.md`

Frontmatter (tags, source, tier) + an executable JSON block: an ordered
device list with param snapshots (from `device.get`, raw values + recorded
display values where known), applied via `device.insert` + `device.param`.
Limits per ADR-001: stock devices only. VST chains are recorded
descriptively (name + manual settings prose) but are not auto-appliable.

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


The `## Executable` section is the contract: whenever knowledge can be
expressed as notation, a pipeline spec, or a recipe, it must be. Prose alone
is a last resort. This keeps the KB deterministic instead of vibes.

## Command surface (all buildable on existing gateway ops)

```
awh save <clipPath> --as <slug> --category hats --tags garage,shuffle
                                   # capture notes+context from the open Set
awh chain save <trackOrDevicePath> --as <slug>   # device-chain recipe
awh lib list [--tags ...] [--category ...]        # browse
awh lib show <slug>                               # print entry
awh lib place <slug> <target> [--arrange --at-bar N] [--transpose-to-scale]
awh lib index                                     # regenerate INDEX.md files
awh distill                    # batch: walk the open project, agent-guided
                               # capture of notable clips + chains + a project
                               # summary note (knowledge/projects/<name>.md)
```


## Right-click capture (extension sandbox constraint)

The extension cannot write into the repo (file access is limited to its
storage/temp dirs, a pre-announced OS sandbox). Design: an **outbox**.

1. Context-menu "AWH: Save clip to library" (AudioClip + MidiClip scopes):
   the handler captures the full clip payload and appends it to an
   in-extension outbox (persisted in `storageDirectory`).
2. New gateway op `library.outbox` returns + clears pending entries.
3. `awh lib import` (run any time; the skill runs it at session start)
   drains the outbox into `library/inbox/` files for
   naming/tagging/tier-assignment: quick capture mid-session, curation later.
   v1 is zero-dialog (auto-slug); a name/tags webview dialog can come later.

## Knowledge domains (owner requirements, 2026-08-17)

- **Domains are open-ended.** `knowledge/<topic>/<slug>.md` imposes no fixed
  topic list; a new domain is a new directory (`setup/` was first, for the
  sidechain template; `rhythm/`, `mixing/`, `sound-design/`, `projects/` are
  anticipated, not enumerated). The INDEX generator and retrieval
  instructions discover topics from the tree, never from a hardcoded list.
- **Measurement records are part of the knowledge surface.**
  `library/measurements/` (mix reports saved by `awh mix report --save` /
  auto-recorded reference measurements) is indexed alongside `knowledge/`,
  retrievable by the same flows ("what did my references measure?"), and
  citable in entries (a mixing note can link the record it was derived
  from). Records stay JSON (data, not prose); knowledge entries wrap
  interpretation around them.

## Knowledge lifecycle

- **Seeding**: research agents distill external sources (genre tropes,
  sound design recipes, artist techniques) into `sourced` entries with
  citations, as batched, reviewable PRs. Owner requests look like "distill
  how <artist> does <x>".
- **From own work**: `awh distill` + "save what we learned today" at the end
  of a working session → `draft`/`verified` entries.
- **Promotion**: the owner (or a Live-validated run) bumps `draft` →
  `verified` after real use. Tier changes are ordinary git diffs.
- **Retrieval**: the `awh` skill instructs the agent to grep `knowledge/` +
  `library/` INDEX files before genre/technique tasks and to cite slug +
  tier when applying an entry ("using garage-hat-shuffle [sourced]").
- "Emulate my hi-hat chain from song X" = `awh lib place` (clip) +
  `awh chain apply` (recipe), both resolved by search over the owner's own
  captured material.

## B3d — Live User Library sync (.alc mirror) [design firm; research done]

Owner requirement (2026-08-17): saved clips should also appear in Live's
browser as `.alc` Live Clips, tagged, so the library is usable inside Live
without a terminal. Full findings and sources:
`docs/research/alc-live-library.md`. **Verdict: feasible in Node under MIT,
high confidence.**

Architecture (firm):

- **The git library stays the source of truth.** The Live-visible copy is a
  generated, disposable directory-based Pack ("AWH Library", alpax model).
  `awh lib export-alc` renders each library clip to
  `<mirror>/<category>/<slug>.alc` and writes `Ableton Folder Info/
  Properties.cfg` with a stable `PackUniqueID` and a `PackRevision` bumped
  on every export. That bump is Live's supported re-index trigger, so
  changes appear without database hacks or restarts. The owner drags the
  folder into Places once. Generation-only: a bad generated file fails to
  load and harms nothing.
- **.alc generation = template capture.** An .alc is a gzipped one-track
  LiveSet XML (`Tracks > MidiTrack > … > MidiClip > Notes > KeyTracks`,
  notes as `MidiNoteEvent Time/Duration/Velocity` grouped per pitch under
  `KeyTrack/MidiKey`). No published minimal file exists, old Lives
  hard-reject unknown elements, and wrong values crash silently. So we never
  hand-construct the schema: capture one golden template by saving a real
  clip from the owner's Live 12, keep the gunzipped XML, and substitute
  notes/name/length/signature at export. MIDI-only clips avoid the
  sample-FileRef minefield entirely.
- **Tags: verified writable.** Live 12 tags live in XMP sidecars
  (`Ableton Folder Info/*.xmp`, namespace `ablFR`, keywords as
  `Group|Tag|Sub Tag` paths). The SQLite Live Database is a rebuildable
  cache, and `Library.cfg` holds config we never touch. Live auto-creates
  unknown tags on scan, so the pack XMP maps each clip to `AWH|<category>`
  plus its frontmatter tags. Proven by MIT prior art (LiveTagger, alpax).
  Correction: there is no "Clips: Drum/Music Clip" tag group (that is a
  content-type filter) and no auto Key tag for clips; key/genre tags are
  ours to assign from frontmatter.
- **Belt-and-braces**: category + slug are also encoded in folder/filenames
  (browser-searchable regardless of XMP format changes).
- **Reverse flow**: `awh lib import-alc <file>` gunzips and walks KeyTracks
  (alcmixer's MIT traversal as parse spec) and reads the folder sidecar XMP
  for user-assigned tags. This is the capture path for material that never
  went through awh.
- **Safety lines**: write only inside our own mirror; never edit user
  files, `Library.cfg`, the Live Database, or `Ableton Folder Info` folders
  we did not create; back up any XMP we rewrite. Do not attempt
  Key/similarity metadata (analysis-derived, not writable) or .alp binary
  packs (undocumented; directory packs suffice).

## Out of scope (recorded so they don't creep in silently)

- No embedding/vector search until grep + tags demonstrably fail at scale.
- No audio media in git (references only); no automatic scraping
  pipelines. Distillation is always an explicit request with cited sources.
- VST internals in recipes stay descriptive (ADR-001 constraint).
