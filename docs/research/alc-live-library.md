# Research: .alc generation + Live 12 browser tags (for B3d)

- Date: 2026-08-17 · Status: complete · Feeds: `docs/design/library-kb.md` §B3d
- Question: can `awh` generate `.alc` Live Clips into the User Library and tag
  them in Live 12's browser — safely, in Node, under MIT licensing?
- **Verdict: yes, high confidence.** Both formats are plain files with working
  MIT-licensed prior art; the risky failure modes are bounded to files we
  generate ourselves.

## 1. The .alc format

### Verified

- **.alc is gzipped XML, same schema family as .als** (Ableton help:
  [Live file types](https://help.ableton.com/hc/en-us/articles/209769625-Live-specific-file-types),
  [Using Live Clips](https://help.ableton.com/hc/en-us/articles/209071569-Using-Live-Clips-alc-files);
  confirmed first-hand by tools that round-trip .alc files Live then loads).
- Real Live 12 header (from buildable's Live-12-saved fixture):
  `<Ableton MajorVersion="5" MinorVersion="12.0_12049" SchemaChangeCount="3"
  Creator="Ableton Live 12.0.5d1" Revision="">` → `<LiveSet>` with
  `NextPointeeId`, `OverwriteProtectionNumber`, then `Tracks`. Tab-indented
  UTF-8; the gzip member Live writes is bare (no filename, MTIME=0).
- **A MIDI .alc is a one-track LiveSet**: `Ableton > LiveSet > Tracks >
  MidiTrack > DeviceChain > MainSequencer > ClipSlotList > ClipSlot > ClipSlot
  > Value > MidiClip`. Notes live in `MidiClip > Notes > KeyTracks > KeyTrack`
  (`MidiKey Value="36"` + `Notes > MidiNoteEvent` with `Time`, `Duration`,
  `Velocity` attributes). The .alc also carries the source track's device
  chain and clip envelopes. Audio Live Clips reference the sample by path
  (`SampleRef/FileRef`) — never embedded audio. (Parse spec:
  [alcmixer](https://github.com/danikavu/Ableton-Live-Clip-Mixer)'s
  `extract_alc_features.py`, MIT, parses factory .alc files.)
- **Re-serialization is tolerated**: the MPE Simplifier round-trips Live 12.x
  .alc files through Python ElementTree + re-gzip and Live loads the result.
- **Version tolerance is asymmetric**
  ([ableton-als](https://github.com/kevinkirsten/ableton-als), measured against
  real Live 10/12): newer-saved files refuse to open in older Lives; *older*
  schema opens fine in Live 12 and is silently upgraded (factory Live Clips
  are old-schema). Older Lives hard-reject a single unknown attribute; a wrong
  *value* in a known field passes checks and crashes at load with no message.
  So: emit exactly what Live 12 emits, never invent elements.
- **No published minimal-valid-.alc exists.** Everyone who writes these
  successfully converges on **template capture**: save a real clip to the User
  Library from Live 12 once, gunzip it, keep the XML as the golden template,
  substitute Notes/name/tempo. That's our strategy. (Live-11+ note attributes
  like `NoteId`/`Probability`/`VelocityDeviation` are community knowledge only
  — capture them from the real template rather than trusting write-ups.)

### Tooling inventory (license-checked)

| Project | Does | License |
|---|---|---|
| [buildable](https://github.com/kmontag/buildable) | reads/writes/combines .als, Live-round-trip tested, maintains `NextPointeeId`/Id hygiene | MIT |
| [ableton-als](https://github.com/kevinkirsten/ableton-als) | TS zero-dep .als surgical edits, 12→10 downgrade; the version-behavior findings above | MIT |
| [alcmixer](https://github.com/danikavu/Ableton-Live-Clip-Mixer) | parses .alc → notes (our parse spec) | MIT |
| [LiveTagger](https://github.com/17cupsofcoffee/LiveTagger) | batch-writes Live 12 tag XMPs (tested vs 12.3) | MIT |
| [alpax](https://github.com/kmontag/alpax) | generates directory-based Live Packs incl. tags + previews | MIT |
| [dawtool](https://github.com/offlinemark/dawtool) | .als tempo/marker parsing | BSD-3 (Ableton part) |
| [MPE Simplifier](https://github.com/DoubleStrike/Ableton-Live-MPE-Simplifier) | .alc round-trip proof | AGPL — do not copy (author asks); evidence only |
| [abletoolz](https://github.com/elixirbeats/abletoolz) | version-aware .als editing 8.2–12 | GPL — subprocess only |
| als-tools, als-parser | analysis | no license — avoid |
| Ableton [Live Set Export](https://ableton.github.io/export/) | official .als writer | proprietary, iOS-only — unusable |

Implement natively in Node (`zlib.gzipSync` + templating — the format is
trivial); crib *behavior* from the MIT/BSD rows only.

## 2. Live 12 browser tags

### Verified

- **Source of truth is XMP sidecar files, not the database.** For user
  folders: `<folder>/Ableton Folder Info/dc66a3fa-0fe1-5352-91cf-3ec237e9ee90.xmp`
  (fixed filename). The SQLite Live Database (`files.db` etc.) is a
  **rebuildable cache** — deleting it triggers re-index from content + XMP.
  Collections colors + tag config live in `Library.cfg` (we never touch it).
  Paths inside XMPs are relative → tagged folders are portable.
  (Sources: Ableton [Browser & Tags FAQ](https://help.ableton.com/hc/en-us/articles/11425042663708-Browser-and-Tags-in-Live-12-FAQ),
  [Resetting Live's Database](https://help.ableton.com/hc/en-us/articles/360000794970-Resetting-Live-s-Database),
  forum threads t=249565/t=249669/t=250285, LiveTagger's working code.)
- **Exact XMP schema** (from LiveTagger + alpax, both accepted by Live):
  namespace `ablFR = https://ns.ableton.com/xmp/fs-resources/1.0/`;
  `dc:format` = `application/vnd.ableton.folder` (or `.factory-pack`);
  `ablFR:items` = `rdf:Bag` of `{ablFR:filePath, ablFR:keywords}` structs;
  each keyword is a full display path **`Group|Tag|Sub Tag`**. **Unknown tags
  are auto-created by Live on scan** — we can invent an `AWH` group freely.
- **Pack model** ([alpax](https://github.com/kmontag/alpax)): a plain folder
  becomes a browser Pack via `Ableton Folder Info/Properties.cfg`
  (`PackUniqueID`, `PackDisplayName`, `PackRevision`, …) + a pack XMP.
  **Bumping `PackRevision` makes Live re-index the pack** — a clean,
  behavior-supported "notice my changes" trigger. User drags the folder into
  Places once.
- Third-party tag writing is proven and reversible (LiveTagger last tested vs
  Live 12.3, keeps `.xmp.bak` backups). Plausible-not-verified: Live picks up
  XMP edits only on rescan/restart — write while Live is closed, or use the
  PackRevision trigger.
- **User Library**: `~/Music/Ableton/User Library` (relocatable), conventional
  `Clips/` subfolder. Folder names AND filenames are browser-searchable — so
  folder/filename structure is a zero-risk fallback taxonomy.

### Corrections to the original request

- **No "Clips: Drum Clip / Music Clip" tag group exists** — "Clips" in the
  browser is a *content-type filter*, not a tag. No automatic Key tag either
  (Live 12.1 auto-tags apply to *samples* < 60 s: Loop/One-Shot, drum-hit
  type, instrument — not to .alc clips, and never musical key). Key/genre
  style tags on our clips are ones **we** assign from library frontmatter.
- Sound Similarity data is analysis-derived and not user-writable — out of
  scope.

## 3. Recommended architecture (adopted into B3d)

1. **Git stays source of truth; the Live mirror is a generated, disposable
   directory Pack** ("AWH Library"): `awh lib export-alc` renders
   `<mirror>/<category>/<slug>.alc` from library entries, writes
   `Properties.cfg` with a stable `PackUniqueID` and a **bumped
   `PackRevision`** per export, plus the pack XMP mapping each file to
   `AWH|<category>` + frontmatter tags. Owner drags the folder into Places
   once; every later export shows up via the revision bump.
2. **.alc generation = template capture**: one-time golden template from a
   real Live 12 save; substitute notes (KeyTracks grouped by pitch), clip
   name, length, signature. MIDI-only avoids the FileRef minefield entirely.
3. **Belt-and-braces naming**: category/slug in folder + filename regardless
   of XMP — searchable even if Ableton changes the tag format.
4. **Safety lines**: write only inside our own mirror directory; never edit
   user files, `Library.cfg`, the Live Database, or `Ableton Folder Info`
   folders we didn't create; keep backups of any XMP we rewrite.
5. **Reverse flow** (`awh lib import-alc`): gunzip + walk KeyTracks (alcmixer
   traversal), read the folder's sidecar XMP for user-assigned tags.
6. **Don't attempt**: Key/similarity metadata writes, .alp binary packs
   (undocumented; directory packs suffice), tagging anything outside the
   mirror.
