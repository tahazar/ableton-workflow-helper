---
slug: 808-bass-craft
topic: rhythm
tier: sourced
tags: [trap, hip-hop, 808, bass, slide, key-tracking, triplet-flow, glide]
sources: ["https://www.productionmusiclive.com/blogs/news/trap-beat-guide-bass-essential-tips-for-making-808-patterns", "https://create.routenote.com/blog/how-to-make-trap-beats-pt-3-808-basslines/", "https://itsgratuitous.com/how-to-slide-808s-in-fl-studio/", "https://reaper.blog/2019/01/808bassline/", "https://producersociety.com/slide-808s-tutorial-garageband/", "https://www.iconcollective.edu/808-mixing-tips", "https://gearspace.com/board/rap-hip-hop-engineering-and-production/874866-so-apparently-theres-3-ways-tune-808-a.html", "https://soundcy.com/article/how-to-make-808s-not-sound-out-of-tune", "https://arxiv.org/abs/2502.07524", "https://www.attackmagazine.com/technique/tutorials/creating-808-style-basslines-for-jungle-trap-and-footwork/", "https://www.musicradar.com/tuition/tech/10-tricks-every-trap-producer-should-know-638684", "https://www.masteringthemix.com/blogs/learn/creating-a-punchy-low-end-tips-for-balancing-kick-and-bass", "https://news.djcity.com/how-the-triplet-flow-took-over-rap/", "https://hypebeast.com/2018/9/migos-triplet-flow-hip-hop-rap-video-analysis", "https://ambrosiaforheads.com/2017/09/first-migos-flow-video/", "https://www.atlantamagazine.com/news-culture-articles/vox-video-explains-key-part-migos-sounds-like-migos/"]
related: [rhythm/808-style-slide-pickup, rhythm/waivops-drum-stats-pilot, sound-design/operator-recipe-glide-bass, rhythm/drum-style-hybrid-trap]
---
# 808 bassline craft: trap/hip-hop conventions

**Sourcing note:** sources were consulted through search excerpts tied to
named pages, not full-page reads (as in `rhythm/dubstep-drum-pattern` and
`rhythm/arp-style-trance-16ths`). A clean, specific claim from one page is
cited to that page. Generic advice that several tutorials share is cited to
the group ("converges across X/Y/Z"). The one academic source (an
arXiv/ISMIR paper) was read as an abstract/excerpt, not the full PDF, and is
flagged where it conflicts with tutorial folklore.

## Long sustain vs. stab placement: tempo/energy-dependent, not one rule

No source gives a fixed rule for long sustained 808s versus short stabs. The
closest is that the choice tracks tempo and energy: "long, sustained 808s
can affect the energy of fast-paced tracks, while short, punchy 808s might
lack the sustain needed for slower tempos" (productionmusiclive.com, "Trap
Beat Guide: Bass"). The common workaround is one long-decay 808 sample with
note length shaped by the sampler's amp envelope per note, instead of
separate long/short samples (productionmusiclive.com; reaper.blog's
808-bassline walkthrough describes the same approach). Attack Magazine's
jungle/trap/footwork bass tutorial gives the one concrete number found, for
a layered kick+808 tone rather than a bassline note: "a short decay of
150ms, alongside minimum sustain and a fast release, gives a punchier kick
sound" when blending a melodic 808 under a kick. Treat it as a sound-design
data point at the stab end, not a note-length rule.

**Placement, separately from length:** the 808 follows the kick's rhythm.
"The 808 generally follows the pattern laid down by the kick drum, and
placing your 808 bass notes on the kicks helps create a cohesive rhythm
that makes everything sound tight and punchy" (productionmusiclive.com).
Off-kick syncopation is the named variation: "trap beats often employ
syncopation, for instance placing 808 hits on off-beats or unexpected parts
of the measure, which can help create a sense of dissonance and impart a
feeling of tension and groove" (productionmusiclive.com). Kick-locked is the
baseline, off-kick is the exception used for tension. No source gives a
ratio between the two.

## Where slides land: pickup notes at a bar's tail, sliding into the next downbeat

FL Studio, GarageBand and REAPER tutorials describe the same mechanic, the
strongest convergence in this research: a slide needs two overlapping
notes. "The slide note must overlap slightly with the previous note"
(itsgratuitous.com, "How to Slide 808s in FL Studio"); "in the Piano Roll,
overlap the end of one note with the beginning of the next... the overlap
length combined with the glide time determines how fast the 808 slides
between pitches" (producersociety.com). One page gives an overlap length
for the "tight, snappy" feel: a 1/16th-note overlap (itsgratuitous.com),
0.25 beats at any tempo, well above a bare legato-trigger epsilon. Glide
time (the synth's portamento speed, separate from the MIDI overlap) is
roughly 30-80ms for "smooth slides" (producersociety.com). This is the
parameter `sound-design/operator-recipe-glide-bass` [draft] calls `Glide
Time` and independently estimates at ~60ms funky / 150-400ms theatrical,
which corroborates the short-is-funky, long-is-dramatic spectrum from a
different source set.

The one concrete placement claim is a pickup-note convention: "program the
bass with long notes on the downbeat, following the root note of the chord
and jumping up to the 5th in pickup notes" (create.routenote.com, "How to
make Trap Beats Pt. 3 — 808 Basslines"). Combined with the overlap
mechanic: a long root holds through most of the bar, then a short pickup
(commonly the 5th) sits in the bar's tail and slides into the next
downbeat. No source gives a rate for bars ending in a slide versus a clean
stop. "Slides live in bar tails, into downbeats" is a qualitative
convention, not a measured frequency.

## Key-tracking: two different (and disputed) practices share the name

"Tuning the 808 to the key" splits into two practices, and the academic
source disagrees with the folklore on one of them:

- **Sample-tuning practice (the common tutorial advice):** find the 808
  sample's fundamental (by ear, tuner or spectrum analyzer) and transpose
  the sample so its root matches the song's key. "Tuning your 808 is one of
  the most overlooked but essential parts of mixing... a well-tuned 808
  locks into the key of your track" (iconcollective.edu, "808 Mixing
  Tips"). A gearspace thread names three approaches: transpose to the
  song's key root, transpose to match a detected pitch, or leave the sample
  as-is and only play specific notes on it. It also notes that tuning to
  the fourth or fifth of the root is a common alternative "to keep drums
  nice in the frequency spectrum" when kick and 808 would compete
  (gearspace.com, "So Apparently There's 3 Ways to Tune an 808..."). A
  companion piece frames the same +7-semitone fifth-tuning as a kick/808
  frequency-collision fix (soundcy.com).
- **The disputed direction (arXiv/ISMIR finding):** Deruty's peer-reviewed
  analysis of Scott Storch's practice found the opposite causality for at
  least one working producer. The song's key is chosen or transposed to fit
  the 808's narrow usable pitch range, because the drum's timbre only holds
  together over a limited band of fundamentals. The paper reports the
  fundamental-frequency distribution for non-"driven" presets peaking
  around f0 ≈ 49.48 Hz (arxiv.org/abs/2502.07524, "Harmonic and
  Transposition Constraints Arising from the Use of the Roland TR-808 Bass
  Drum"). This is a sourced disagreement: tutorials treat the key as fixed
  and tune the 808 to it, and the case study documents a professional
  workflow doing the reverse. Treat "tune the 808 to the key" as the
  default and "the key bends to the 808's usable range" as a documented
  alternative.

## Triplet-flow lineage: a vocal-delivery convention that fed back into programming

The "Migos flow" (triplet flow) is documented as a rapped delivery before it
is a bass-programming convention: "a triplet is a succession of three notes
played over one beat... rappers use the flow to manipulate the beat and
energy of a track by delivering their rhymes in a triplet cadence"
(news.djcity.com, covering Vox's "Earworm" video essay). Migos' "Versace"
(2013) is credited with taking the flow mainstream, but every lineage source
says Migos did not invent it. The cadence traces back through Three 6
Mafia's "Mystic Stylez" (1995), Bone Thugs-N-Harmony's "Creepin on Ah Come
Up" (1994), and Chuck D's verse on Public Enemy's "Bring The Noise" (1988)
(hypebeast.com; ambrosiaforheads.com, "A Video Traces The 'Migos Flow' Back
To Public Enemy, Bone Thugs & Biggie").

The production-side claim is weaker and aggregated. Sources describe the
triplet feel as pervasive across trap's sequenced parts ("the triplet
rhythmic feel... defines how both hi-hats and vocal deliveries move in
trap") without a citable breakdown of a specific 808 bassline programmed in
triplets because of the Migos flow. The vocal lineage is solid and
multi-decade. "808 bass programming was directly reshaped by the Migos
flow" is a plausible but unsourced extrapolation. The closest measured
trap-rhythm datapoint is one grid step over, on hi-hats:
`rhythm/waivops-drum-stats-pilot` [sourced] measures off-16ths landing
+0.0216 beats late at n=15,000 full-dataset scale. That is a swing
measurement on hats, not a triplet measurement on 808 bass, and says
nothing about the Migos flow's influence.

## Rest/space usage vs. kick interplay

"Leave space" recurs as its own advice: "don't be afraid to leave space in
your 808 pattern as less is often more — a sparse 808 bassline can give the
rest of the beat a chance to breathe" (productionmusiclive.com). The most
concrete named example is Tay Keith's production on the third beat-switch of
Travis Scott's "Sicko Mode": the section "oscillates between the drum
pattern by itself and then accented with an 808... at certain moments the
808 will drop out, the 808 and kick play the same pattern, or the 808 will
replace the kick pattern but play the same rhythm" (masteringthemix.com,
"Creating a Punchy Low End"). This is one well-known case study of
deliberate 808 drop-outs as a hook, not evidence of how common the
technique is. Sidechaining the 808 to the kick is the other convergent
advice: "sidechaining your 808 to your kick drum can help prevent frequency
clashes and create more space, making both elements hit harder"
(productionmusiclive.com). It is a mixing-chain fact, not a note-placement
one, but the sources pair the two.

## What this entry does not claim

No source gave a ratio of long-note bars to stab bars, a percentage of bars
ending in a slide, a velocity curve for 808 dynamics, or a citable link
between a named 808 bassline and the Migos triplet flow. This entry does not
invent those numbers. The key-tracking disagreement (tune the 808 to the key
vs. bend the key to the 808) is left unresolved; pick a side deliberately.
`rhythm/808-style-slide-pickup` [draft] turns the long-root / 5th-pickup /
slide-into-downbeat idiom into one auditionable `awh-808-spec` style. Its
numbers are an authored proposal built on these sourced constraints, not
further-sourced fact.
