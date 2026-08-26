---
slug: 808-bass-craft
topic: rhythm
tier: sourced
tags: [trap, hip-hop, 808, bass, slide, key-tracking, triplet-flow, glide]
sources: ["https://www.productionmusiclive.com/blogs/news/trap-beat-guide-bass-essential-tips-for-making-808-patterns", "https://create.routenote.com/blog/how-to-make-trap-beats-pt-3-808-basslines/", "https://itsgratuitous.com/how-to-slide-808s-in-fl-studio/", "https://reaper.blog/2019/01/808bassline/", "https://producersociety.com/slide-808s-tutorial-garageband/", "https://www.iconcollective.edu/808-mixing-tips", "https://gearspace.com/board/rap-hip-hop-engineering-and-production/874866-so-apparently-theres-3-ways-tune-808-a.html", "https://soundcy.com/article/how-to-make-808s-not-sound-out-of-tune", "https://arxiv.org/abs/2502.07524", "https://www.attackmagazine.com/technique/tutorials/creating-808-style-basslines-for-jungle-trap-and-footwork/", "https://www.musicradar.com/tuition/tech/10-tricks-every-trap-producer-should-know-638684", "https://www.masteringthemix.com/blogs/learn/creating-a-punchy-low-end-tips-for-balancing-kick-and-bass", "https://news.djcity.com/how-the-triplet-flow-took-over-rap/", "https://hypebeast.com/2018/9/migos-triplet-flow-hip-hop-rap-video-analysis", "https://ambrosiaforheads.com/2017/09/first-migos-flow-video/", "https://www.atlantamagazine.com/news-culture-articles/vox-video-explains-key-part-migos-sounds-like-migos/"]
related: [rhythm/808-style-slide-pickup, rhythm/waivops-drum-stats-pilot, sound-design/operator-recipe-glide-bass, rhythm/drum-style-hybrid-trap]
---
# 808 bassline craft: trap/hip-hop conventions

**Sourcing note (this session):** full-page fetch (WebFetch) was unavailable
for essentially every production-tutorial, forum, and paper host tried this
session (production tutorial sites, gearspace.com, arxiv.org among others) —
same egress-blocked situation as `rhythm/dubstep-drum-pattern` and
`rhythm/arp-style-trance-16ths`. Research below is from the web-search
tool's synthesized excerpts, tied to named pages. Where one page's excerpt
gives a clean, specific claim it is cited tightly; where several tutorial
pages converged on the same generic advice without clean per-sentence
attribution, the claim is described as "converges across X/Y/Z" rather than
pinned to one exact sentence. One academic source (an arXiv/ISMIR paper)
was reachable only as a search-tool abstract/excerpt, not the full PDF —
treated the same way, and flagged where its claim conflicts with the
tutorial-level folklore.

## Long sustain vs. stab placement: tempo/energy-dependent, not one rule

No source gives a fixed rule for when to use a long, sustained 808 versus
short stabs — the closest thing to a rule is that the choice tracks tempo
and energy rather than genre convention: "long, sustained 808s can affect
the energy of fast-paced tracks, while short, punchy 808s might lack the
sustain needed for slower tempos" (productionmusiclive.com, "Trap Beat
Guide: Bass"). The practical sound-design workaround given across sources
is to start from one long-decay 808 sample and shape note length with the
sampler's amp envelope per note, rather than keeping separate long/short
samples (productionmusiclive.com; reaper.blog's 808-bassline walkthrough
describes the same one-sample, envelope-shaped approach). Attack Magazine's
jungle/trap/footwork bass tutorial gives the one concrete numeric example
found this session, though for a layered KICK+808 tone rather than a pure
bassline note: "a short decay of 150ms, alongside minimum sustain and a
fast release, gives a punchier kick sound" when blending a melodic 808
under a drum kick — read as a sound-design data point on the
short/stab end of the spectrum, not a bassline-note-length rule.

**Placement, separately from length:** the recurring convention is that the
808 bassline follows the kick's rhythm — "the 808 generally follows the
pattern laid down by the kick drum, and placing your 808 bass notes on the
kicks helps create a cohesive rhythm that makes everything sound tight and
punchy" (productionmusiclive.com) — with syncopated off-kick placements
named as a deliberate variation, not the default: "trap beats often employ
syncopation, for instance placing 808 hits on off-beats or unexpected parts
of the measure, which can help create a sense of dissonance and impart a
feeling of tension and groove" (productionmusiclive.com). Read this as: kick
-locked placement is the idiomatic baseline, off-kick syncopation is the
named exception used for tension, and no source gives a numeric ratio of
how often producers do one versus the other.

## Where slides land: pickup notes at a bar's tail, sliding into the next downbeat

Multiple independent how-to pages (FL Studio, GarageBand, and REAPER
workflow tutorials) describe the SAME mechanic despite different DAWs,
which is the strongest convergence in this research pass: a slide requires
two notes to overlap — "the slide note must overlap slightly with the
previous note" (itsgratuitous.com, "How to Slide 808s in FL Studio"); "in
the Piano Roll, overlap the end of one note with the beginning of the
next... the overlap length combined with the glide time determines how
fast the 808 slides between pitches" (producersociety.com). One page gives
a specific overlap-length figure for the "tight, snappy" feel specifically:
**a 1/16th-note overlap** (itsgratuitous.com) — at any tempo that is 0.25
beats, distinctly bigger than a bare legato-trigger epsilon (see the schema
feedback below). Glide TIME (the synth's portamento speed, separate from
the MIDI overlap) is given as roughly 30-80ms for "smooth slides"
(producersociety.com) — this is the same parameter
`sound-design/operator-recipe-glide-bass` [draft] calls `Glide Time` and
independently estimates at ~60ms funky / 150-400ms theatrical, corroborating
the same short-glide-is-funky, long-glide-is-dramatic spectrum from a
different source set.

On WHERE the slide sits rather than how it's built: the one concrete
placement claim found is a pickup-note convention — "program the bass with
long notes on the downbeat, following the root note of the chord and
jumping up to the 5th in pickup notes" (create.routenote.com, "How to make
Trap Beats Pt. 3 — 808 Basslines"). Read together with the overlap
mechanic above, the idiomatic picture is: a long root note holds through
most of the bar, then a short pickup note (commonly the 5th) sits in the
bar's tail and SLIDES — overlapping into — the next downbeat. No source
gives a numeric rate for how often a bar ends in a slide versus a clean
stop; treat "slides live in bar tails, into downbeats" as the qualitative
convention this session's sources agree on, not a measured frequency.

## Key-tracking: two genuinely different (and disputed) practices share the name

"Tuning the 808 to the key" is not one single practice in the sources found
this session — it splits into two different layers, and the academic source
found directly disagrees with the folklore for one of them:

- **Sample-tuning practice (the common tutorial advice):** identify the
  808 sample's fundamental pitch (by ear, a tuner, or a spectrum analyzer)
  and transpose the SAMPLE so its root matches the song's key — "tuning
  your 808 is one of the most overlooked but essential parts of mixing...
  a well-tuned 808 locks into the key of your track" (iconcollective.edu,
  "808 Mixing Tips"). A gearspace producer-forum thread on this exact
  question describes three named approaches in practice: transpose to the
  song's key root, transpose to match a detected pitch, or leave the
  sample as-is and only ever play specific notes on it — and separately
  notes that tuning to the **fourth or fifth** of the root (not just the
  root itself) is a common alternative "to keep drums nice in the
  frequency spectrum" when the kick and 808 would otherwise compete
  (gearspace.com, "So Apparently There's 3 Ways to Tune an 808..."). A
  companion piece frames the same +7-semitone-above-root fifth-tuning move
  explicitly as a kick/808 frequency-collision fix (soundcy.com).
- **The disputed direction — arXiv/ISMIR finding:** Deruty's peer-reviewed
  analysis of hip-hop producer Scott Storch's practice found the OPPOSITE
  causality for at least one working producer: rather than tuning the 808
  to the song's key, **the song's key is chosen/transposed to fit the
  808's own narrow usable pitch range**, because the drum's characteristic
  timbre only holds together over a limited band of fundamentals — the
  paper reports the fundamental-frequency distribution for non-"driven"
  presets peaking around f0 ≈ 49.48 Hz (arxiv.org/abs/2502.07524,
  "Harmonic and Transposition Constraints Arising from the Use of the
  Roland TR-808 Bass Drum"). **This is a real, sourced disagreement, not a
  rounding error**: the tutorial-level convention treats the song's key as
  fixed and the 808 as the thing that gets tuned to match it; the academic
  case study describes at least one professional workflow doing the
  reverse. Both are cited here rather than silently picking one — a
  producer following this entry should treat "tune the 808 to the key" as
  the common/default practice and "the key bends to the 808's usable
  range" as a documented alternative worth knowing, not a fringe idea.

## Triplet-flow lineage: a vocal-delivery convention that fed back into programming

The "Migos flow"/triplet flow is well-documented as a RAPPED delivery
convention before it is a bass-programming one: "a triplet is a succession
of three notes played over one beat... rappers use the flow to manipulate
the beat and energy of a track by delivering their rhymes in a triplet
cadence" (news.djcity.com, covering Vox's "Earworm" video essay). Migos'
"Versace" (2013) is repeatedly credited as the track that took the flow
mainstream, but every source that discusses lineage is explicit that Migos
did not invent it — the same triplet cadence is traced back through Three 6
Mafia's "Mystic Stylez" (1995), Bone Thugs-N-Harmony's "Creepin on Ah Come
Up" (1994), and as far back as Chuck D's verse on Public Enemy's "Bring The
Noise" (1988) (hypebeast.com; ambrosiaforheads.com, "A Video Traces The
'Migos Flow' Back To Public Enemy, Bone Thugs & Biggie"). **The
production-side claim is a weaker, more aggregated one**: sources describe
the triplet FEEL as now pervasive across trap's sequenced parts generally —
"the triplet rhythmic feel... defines how both hi-hats and vocal deliveries
move in trap" — without giving a citable, named breakdown of a specific
808 bassline programmed in triplets because of the Migos flow specifically.
Treat the lineage (vocal delivery, well-sourced, multi-decade) as solid,
and the specific claim "808 bass programming was directly reshaped by the
Migos flow" as a plausible but NOT cleanly sourced extrapolation this
session — the sourced, citable triplet-on-drums datapoint is one grid step
over, on hi-hats: `rhythm/waivops-drum-stats-pilot` [sourced] measures
trap hi-hat swing directly (off-16ths landing +0.0216 beats late at
n=15,000 full-dataset scale) but that is a swing/timing measurement on
HATS, not a triplet-subdivision measurement on 808 bass, and not itself
about the Migos flow's influence — cited here as the closest adjacent,
actually-measured trap-rhythm datapoint, not as confirmation of the lineage
claim.

## Rest/space usage vs. kick interplay

Beyond the "808 follows the kick" placement convention above, "leave space"
recurs as its own named piece of advice, independent of any specific
placement rule: "don't be afraid to leave space in your 808 pattern as less
is often more — a sparse 808 bassline can give the rest of the beat a
chance to breathe" (productionmusiclive.com). The most concrete named
example of space-as-arrangement-device found this session is Tay Keith's
production on the third beat-switch of Travis Scott's "Sicko Mode": the
section "oscillates between the drum pattern by itself and then accented
with an 808... at certain moments the 808 will drop out, the 808 and kick
play the same pattern, or the 808 will replace the kick pattern but play
the same rhythm" (masteringthemix.com, "Creating a Punchy Low End"). Read
this as a single well-known, named case study of a general principle
(deliberate 808 drop-outs as a hook), not as evidence of how common that
specific technique is across trap production broadly. Sidechaining the 808
to the kick is the other convergent piece of advice tying rest/interplay to
mix practice rather than pattern-writing — "sidechaining your 808 to your
kick drum can help prevent frequency clashes and create more space, making
both elements hit harder" (productionmusiclive.com) — a mixing-chain fact,
not a note-placement one, but the two work together in the sources'
own telling.

## What this entry does NOT claim

No source in this session gave a numeric ratio of long-note bars to
stab bars, a measured percentage of bars that end in a slide, a velocity
curve/number for 808 dynamics, or a citable breakdown connecting a named
808 bassline to the Migos triplet flow specifically — those would be
invented precision this entry refuses to fabricate. The key-tracking
disagreement (tune-808-to-key vs. bend-the-key-to-the-808) is presented as
a real, sourced conflict rather than resolved one way; a producer should
pick a side deliberately rather than assume the tutorial-level convention
is the only professional practice. `rhythm/808-style-slide-pickup` [draft]
turns the long-root / 5th-pickup / slide-into-downbeat idiom above into one
concrete, auditionable `awh-808-spec` style; treat its specific numbers as
an authored proposal built on this entry's sourced constraints, not as
further-sourced fact.
