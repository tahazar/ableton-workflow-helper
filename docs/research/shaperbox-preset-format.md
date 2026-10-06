# Research: ShaperBox 3 preset format + duck-envelope craft (Aug 2026)

- Question: can `awh mix duck` write a Volume Shaper preset with the fitted
  curve, instead of printing points to draw?
- **Verdict: no. Manual transfer via the UI is the supported path.** It is
  partially automatable only by hosting the real plugin binary, which is not
  worth it.

## Preset format (Topic 1)

- ShaperBox 3 stores user presets in `~/Library/Cableguys/ShaperBox3/`: a
  `presets.db` SQLite index + a content-addressed blob store
  (`{hash[0]}/{hash[1]}/{hash}.dat`, hash = MD5 of chunk+name). The `.dat`
  payload starts with `#zip#\0` followed by a zlib-compressed JUCE ValueTree
  in binary form, not text/XML/JSON. (Grounded in
  [shaperbox-importer](https://github.com/PhillipAmend/shaperbox-importer)'s
  source, read directly; single-source, not officially documented.)
- The ValueTree container codec is public (JUCE is open source), but the
  Cableguys node/property schema for the drawn curve (points, curve types,
  module params) is undocumented and not reverse-engineered. That is the
  blocker: nobody has published a decoded ShaperBox preset tree.
- The only prior automation (`shaperbox-importer`) hosts the actual plugin
  via Spotify Pedalboard and calls its own preset load/save; it never
  hand-builds curve data. A second tool does raw UI mouse automation.
  `.vstpreset`/`.fst` containers embed the same opaque `#zip#` blob.
- Unexplored lead (speculative): v3.5.1+ has global LFO copy/paste via the OS
  clipboard, and the clipboard representation might be simpler than the
  on-disk blob. Worth a 10-minute look on the owner's machine (copy a curve,
  inspect the clipboard) before attempting file-level generation.

## Drawing mechanics that matter for `awh mix duck` output transfer

(From the Cableguys manual/support pages via search excerpts; good
confidence, not independently fetched.)

- LFO Length is switchable: tempo-synced bars/beats (1/128–32 bars), Hz, or
  milliseconds. Ms mode matches our fitted output directly; beats mode suits
  tempo-portable curves.
- Points are freely placed; Snap to Grid (+ "Move points to grid", Shift
  inverts snap) makes exact placement practical. Each point has a curve type:
  sharp corner (instant, internally de-clicked), smoothed corner, or smooth.
  Use sharp for the dip at t=0 and smooth for the release.
- MIDI Trigger: "On" = curve restarts on every trigger note (our model); "On
  (1-Shot)" = plays once per note. Anti-Click Trigger Smoothing adds ~6 ms
  lookahead by default (0 ms latency in MIDI mode if disabled), so a fitted
  attack of 0 ms is realizable.
- Transfer between instances/projects: global LFO copy/paste or the
  per-shaper Favorites bank. Draw once, reuse.
- Alternative: ShaperBox's own Envelope Follower module (external sidechain +
  Adaptive Release) derives the duck from the kick's real-time energy. That
  is the "measured duck" idea as a built-in, at the cost of the fixed-shape
  determinism the owner's template is built on.

## Craft conventions (Topic 2 — tutorial lore, not ground truth)

- Depth: 3–6 dB is the repeatedly cited "musical, not pumping" range (Attack
  Magazine: up to ~6 dB on a bassline before obvious pumping); trap/808:
  4–6 dB, "kick cracks through the 808"; deep stylized EDM pump runs well
  past that. `awh mix duck`'s default is **6 dB**; the masking-based
  computation (with a bass capture) supersedes lore.
- Attack fast (1–10 ms); release 50–200 ms, tempo-dependent, with the
  universal rule *recovered just before the next hit*. The fitter enforces
  this structurally (85% of the smallest trigger gap).
- Curve shape: sharp drop + exponential/curved recovery is the named
  convention for hand-drawn volume-shaper ducks. Log-ish/softer recovery
  reads "house/transparent"; hard exponential reads "EDM pump".
- Masking basis: kick and bass compete ~20–160 Hz. A kick's low tail can ring
  toward ~1 s, which is why hold+release should track the *measured* tail
  (our approach), with "tighten the kick's own decay" as the complementary
  fix when the tail forces a groove-killing duck length.
