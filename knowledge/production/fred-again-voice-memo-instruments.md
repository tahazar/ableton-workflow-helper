---
slug: fred-again-voice-memo-instruments
topic: production
tier: sourced
tags: [fred-again, sampling, simpler, resampling, vocal, found-sound]
sources: ["https://www.soundonsound.com/people/fred-gibson-aka-fred-again", "https://www.npr.org/2022/11/12/1136054396/how-fred-again-transforms-the-sounds-of-social-media-into-rave-worthy-beauty", "https://www.thefader.com/2022/10/27/fred-again-the-fader-interview-actual-life-3", "https://en.wikipedia.org/wiki/Marea_(We've_Lost_Dancing)", "https://melodics.com/blog/what-daw-does-fred-again-use"]
related: [production/fred-again-vocal-chop-hooks, production/fred-again-texture-chain, production/fred-again-drum-programming]
---
# Fred again..: turning a voice memo into a pitched instrument

## Executable
Source material, per the FADER interview: whole tracks are built from a
single found clip someone sent him: a short video from Eyelar ("Eyelar
(shutters)"), a video from Delilah Montagu ("Delilah (pull me out of
this)"), and a voice note from Berwyn ("Berwyn (all that i got is you)").
Per Wikipedia's account of "Marea (We've Lost Dancing)," that track uses a
voicemail The Blessed Madonna left him about losing club culture during
lockdown. NPR frames the broader habit as building albums that "feel like a
collaborative diary." Pick emotionally loaded, technically rough source
audio on purpose, and do not clean it up before it becomes an instrument.

His stated pitching/shaping tool (Sound on Sound) is NI Battery, not
Ableton's Simpler. His reported main DAW is Logic Pro (Melodics), and
Battery is the plugin instrument he hosts inside it. The steps below
translate his described Battery workflow to stock Live; they are not a
device chain he uses:

1. Drop the voice-memo/video audio into a fresh **Simpler**, one-shot mode
   (single source clip, not a multisample).
2. Warp mode: Repitch if you want pitch and duration to move together
   (closer to the "tape"-like character he describes); Complex Pro if a
   wide pitch move must stay time-locked to the grid. The source does not
   say which he'd pick in Live; this is a translation choice, not a sourced
   fact.
3. Transpose: he describes the Battery move as pitching a sound "down like
   20 semitones" (quoted in full below). Use −20 st as the sourced starting point
   when the goal is a low, instrument-like tone from a vocal source, then
   audition from there.
4. Shape primarily with Simpler's **Volume envelope (ADSR)**, before EQ or
   distortion. Per Fred, the ADSR is central: "90 percent of drum
   manipulation, I find I just do with the ADSR [envelope]." He says this about drums, but it describes his general
   envelope-first Battery habit. Apply it to a pitched vocal instrument:
   tight Attack for a percussive/plucked stab, short Release to make it
   choppable, long Release to let a sung phrase bloom.
5. Saturator (stock Live) after Simpler's envelope, approximating his
   "mash it through tape saturation" step. Drive amount is unstated.
6. Route to a bus with one Compressor. Fred describes Battery giving him
   "a good master compression bus for them all"; ratio/threshold unstated.

No source gives exact ADSR ms values, saturation drive, or compressor
settings. Only the order of operations (pitch → envelope → saturation → bus
compression) and the one concrete number (~−20 semitones) are sourced.
Treat anything more specific as your own tuning, not an artist-sourced
fact.

## The rule
Per Sound on Sound's interview with Fred Gibson: he uses Battery "because
it's the quickest way you can easily pitch them and add compression,"
citing "all the stuff I like in terms of being able to pitch a sound down
like 20 semitones really quickly and mash it through tape saturation," and
says "90 percent of drum manipulation, I find I just do with the ADSR
[envelope]." Per the FADER interview, "Eyelar (shutters)," "Delilah (pull
me out of this)," and "Berwyn (all that i got is you)" each sample a video
or voice note a friend sent him directly. Per NPR, the found-sound habit
started with him "always filming random content on his phone," so everyday
clips, not studio takes, became his instrument sources. Wikipedia records
"Marea (We've Lost Dancing)" as built around a lockdown-era voicemail from
The Blessed Madonna about the loss of club culture. The found clip is the
song's starting point, not decoration added later.
