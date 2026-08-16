# Research: Reference Track Analysis — Reliability Assessment (Aug 2026)

Context: owner's workflow starts by dropping a reference into the project and
marking sections (intro/build/drop/breakdown) before arranging. Question: what
can be automated *without hallucinated results*? Genres: house/techno + trap.

## Reliability ranking (probability the output is simply correct, on 4/4 electronic)

1. **Energy/LUFS/band-energy curves — deterministic, ~100%** (arithmetic, cannot hallucinate)
2. **Tempo — ~90–98%** (GiantSteps EDM: Acc1 90.2%/Acc2 97.6%; residual = octave choice, solved with genre priors 118–150 BPM house/techno, half-time trap)
3. **Beats — ~90–96%** (SOTA F≈0.89 cross-genre, higher on four-on-the-floor)
4. **Downbeats — ~75–90%** (failure mode = bar phase offset; cheap one-tap correction)
5. **Section boundaries — ~70–73%** @3s tolerance (SongFormer, 2025 SOTA)
6. **Section labels — ~74–81%** frame accuracy **with a pop vocabulary** — and generic
   models label techno drops as "chorus"/breakdowns as "bridge" (Harmonix vocab has
   no drop/build/breakdown at all)
7. Fine per-stem spectral comparisons — below everything; skip

## Tier verdicts

**RELIABLE — ship without correction UI:**
- Tempo + beat/bar grid (Beat This!, MIT code AND weights — NOT madmom, whose
  models are CC BY-NC; decode MP3s to WAV via pinned ffmpeg first: decoder offsets
  shift beats 20–40 ms)
- Bar-synced energy arc: short-term LUFS + sub-band (<100 Hz) energy per bar —
  a breakdown is literally "sub energy ≈ 0"; this alone reveals EDM structure
- Full-mix measurement profile vs our track: spectrum, loudness, DR, stereo/phase
  (the iZotope Audiolens / Metric AB feature class — the most trusted reference
  tools ship exactly and only these deterministic measurements)
- **Rule-based drop/build/breakdown detection on four-on-the-floor**: candidate
  drop = large full-band + sub jump at a downbeat on an 8/16-bar multiple, preceded
  by ≥8 bars of rising HF with suppressed sub, following a low-sub section. All
  inputs deterministic except the beat grid (our most reliable ML output). More
  trustworthy on EDM than any generic ML labeler; academic support: EDM structure
  is defined by energy/rhythm/timbre, not harmony (EDMFormer, arXiv 2603.08759).

**DRAFT-QUALITY — only with visible confidence + easy human correction:**
- Downbeat phase (offer "shift by one beat")
- ML section boundaries/labels — if used, EDM-vocabulary models (EDMFormer,
  CC-BY-4.0; Raveform dataset, MIT, 1,423 expert-annotated EDM tracks) — never
  generic pop labels on techno. Precedent: rekordbox Phrase Analysis ships this
  way (draft + manual phrase editor; users correct most tracks)
- Key detection: ~85–90% on dance music (Mixed In Key 89% in 2026 Dubspot test;
  libkeyfinder ~90% on dance, GPL → subprocess only). Errors are structured
  (fifth/relative confusions). Trap = lower confidence, treat as suggestion
- Per-stem presence lanes from separation (HTDemucs ~9.2 dB SDR / BS-RoFormer
  ~12 dB): good for "bass enters here, vocals out here"; known skews: trap 808s
  straddle drums/bass stems, synth/vocal bleed, "other" stem is a garbage class

**NOT TRUSTWORTHY — skip:**
- Generic pop section labels verbatim on electronic music
- Fine per-stem spectral claims ("hi-hat stem 3 dB bright at 8 kHz vs reference") —
  separation artifacts are the same magnitude as the differences reported
- Measurements from the "other" stem presented as a single instrument
- Chord-level harmonic analysis of sparse electronic music

## License matrix (relevant to our stack)

| Component | Verdict |
|---|---|
| Beat This! (beat/downbeat) | MIT code + weights — **use this** |
| madmom | BSD code but CC BY-NC-SA models; unmaintained — avoid |
| allin1 (All-In-One) | MIT repo but runtime-depends on madmom NC models + Demucs weights — avoid as-is |
| SongFormer / EDMFormer | CC-BY-4.0 — OK with attribution; heavy pipeline |
| Raveform dataset | MIT — fine-tune material |
| librosa / pyloudnorm | ISC / MIT — core stack |
| Essentia | AGPL — excluded |
| libkeyfinder | GPL-3 — subprocess only |
| Demucs weights / BS-RoFormer community checkpoints | unresolved / undeclared provenance — fine for private personal use; blocker if we ever distribute |

## Implications for the project

1. The owner's manual habit maps to a **deterministic-first pipeline**: bar grid +
   energy arc + rule-based energy events, presented as a draft section map the
   owner corrects — matching the stated bar ("manual over hallucinated").
2. **SDK constraint:** cue-point times are read-only, so we cannot place locators.
   Workaround: write the section map as named/colored empty clips on a dedicated
   "Sections" marker track (arrangement create-at-position works). The owner's
   corrections = moving/renaming those clips, which we read back.
3. Reference *mix* comparison (deterministic full-mix profile) belongs in the M6
   analysis engine; reference *arrangement* deconstruction is its own feature.
4. Nobody ships reference arrangement deconstruction (section map + presence
   lanes + energy arc) as a producer tool — the building blocks exist at draft
   quality. Genuine gap, and directly serves the owner's existing workflow.
