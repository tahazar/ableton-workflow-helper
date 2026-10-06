---
slug: fred-again-texture-chain
topic: production
tier: sourced
tags: [fred-again, texture, lo-fi, reverb, sidechain, actual-life]
sources: ["https://www.musicradar.com/artists/the-best-feeling-is-when-you-play-back-the-thing-youve-made-that-day-and-you-actually-feel-good-about-it-thats-the-drug-im-chasing-every-day-unlocking-the-production-tricks-that-fred-again-swears-by", "https://www.musicradar.com/artists/ive-spent-so-many-thousands-of-hours-wasted-on-plugins-it-just-doesnt-matter-fred-again-on-how-getting-into-the-weeds-with-software-can-distract-from-songwriting-and-make-you-less-creative", "https://en.wikipedia.org/wiki/Marea_(We've_Lost_Dancing)", "https://www.npr.org/2022/11/12/1136054396/how-fred-again-transforms-the-sounds-of-social-media-into-rave-worthy-beauty"]
related: [production/fred-again-vocal-chop-hooks, production/fred-again-voice-memo-instruments]
---
# Fred again..: the Actual Life-era lo-fi texture chain (stock devices only)

## Executable
Starting point, per MusicRadar's "I've spent so many thousands of hours
wasted on plugins" piece: Fred made the same sound with Logic's stock
plugins and with premium third-party sets and found no meaningful
difference: "in terms of your reverb, compressor, EQ, all these things,"
"it doesn't matter what you choose." That licenses building his texture
with stock Live devices. The technique is the signal chain and where
automation happens, not the plugin brand.

Keep source grit. Per Wikipedia's account of "Marea (We've Lost Dancing),"
the sampled voicemail keeps its original phone/voice-note compression grain
audible in the final track instead of being de-noised or re-recorded. Per
NPR, this fits a broader habit of using phone-quality clips as-is because
the imperfection reads as real. On a found-sound vocal, skip de-noise,
de-ess and de-clip unless the audio is unusable. The codec artifacts are
part of the texture.

Reverb/sidechain-pump chain (stock Live), per MusicRadar's production-tricks
piece. It describes reverb/delay as key to his sound, applied additively via
an aux send with automated levels (see `production/fred-again-vocal-chop-hooks`
for the per-phrase send automation), plus sidechain compression on the
reverb return and a tremolo-style plugin for a pumping effect:

1. Create a return track ("Vocal Verb"): stock **Reverb**, long decay,
   100% wet on the return.
2. On the vocal chop track, send to Vocal Verb with the Sends knob.
   Automate the send level per phrase instead of leaving it fixed (see the
   vocal-chop-hooks entry) so the reverb blooms only where wanted.
3. On the Vocal Verb return track, insert a **Compressor** with Sidechain
   Input set to the Kick track, fast attack. This ducks the reverb wash in
   time with the kick, matching MusicRadar's description of sidechain
   compression "applied independently to the reverb return."
4. Optionally add a rhythmic amplitude effect on the same return (stock
   Live: **Auto Pan** in amplitude mode, or a Utility gain automated with an
   LFO-shaped envelope). This approximates the "tremolo plugin... to create
   a pumping effect" MusicRadar describes, a second tempo-locked layer of
   movement independent of the sidechain compressor.

No source gives decay time, attack/release ms, ratio, threshold, or tremolo
rate. Only the signal path (dry vocal → automated send → return reverb →
sidechained and tremolo'd return) and the "stock devices are enough"
framing are sourced. Do not invent specific numbers for this chain.

## The rule
Per MusicRadar ("I've spent so many thousands of hours wasted on plugins"):
Fred says reverb/compressor/EQ choice "doesn't matter." The texture comes
from where and how those tools are automated, not which plugin generates
them, so a stock-Live chain is not a compromise version of his sound. Per
MusicRadar's companion "production tricks" piece: reverb and delay are
central to his productions, used precisely instead of as a blanket wash,
with sidechain compression on the reverb return and a tremolo-style plugin
layered in for pump. Per Wikipedia and NPR: source grit (phone/voice-note
compression artifacts) is left in deliberately as part of the emotional
texture.
