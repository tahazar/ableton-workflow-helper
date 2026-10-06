---
slug: isoxo-snare-bus-processing
topic: sound-design
tier: sourced
tags: [isoxo, snare, trap, sound-design, saturation, bus, compression]
sources: ["https://soverbsounds.com/blogs/news/how-to-make-isoxo-snare"]
related: [sound-design/isoxo-snare-layering, sound-design/isoxo-snare-pitch-resample]
---
# ISOxo snare: bus saturation + compression after layering

## Executable
Group the 3 layers from `isoxo-snare-layering` into one bus track
("Snare Bus") and process the sum in this order with stock Live devices:

1. **Saturator** (stock): on the post-layer sum, before compression. The
   source gives no drive amount; its stated goal is to make the snare "POP"
   and sound "fat," so start moderate and push by ear against the layered
   mix, not in isolation.
2. **Compressor** (stock, or Glue Compressor for bus-glue character): after
   saturation, gluing the 3 layers into one perceived hit instead of 3
   audible transients.

The source frames this as bus processing, not per-layer processing.
Saturation and compression act on the combined signal after the
transient/body/tonal layers are summed, so their interaction (the
compressor reacting to the saturator's added harmonics, not to 3 separate
dry layers) is part of the effect.

## The rule
Per soverbsounds.com's "How to Make IsoXO Snare": "route all the layers to
a bus and [apply] saturation, compression, and other techniques to make the
snare POP and sound fat." The source names saturation and compression and
mentions unspecified "other techniques." It names no third device and gives
no drive/ratio/threshold numbers for either stage. Do not infer dB or ratio
values from this entry; only the device order and the bus-vs-per-layer
placement are sourced.
