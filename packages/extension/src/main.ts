import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { createGatewayServer, DEFAULT_GATEWAY_PORT } from "@awh/core";
import { LIVE_API_VERSION, SdkLiveBridge } from "./sdkLiveBridge.js";

/**
 * AWH gateway extension entry point. Everything interesting lives in
 * @awh/core; this shell only wires SDK activation to the gateway server.
 *
 * Logs go to ExtensionHost.txt in Live's Preferences folder.
 */
export async function activate(
  activationContext: ActivationContext,
): Promise<void> {
  const ctx = await initialize(activationContext, LIVE_API_VERSION);

  const bridge = new SdkLiveBridge(ctx);
  const server = createGatewayServer(bridge, { port: DEFAULT_GATEWAY_PORT });

  try {
    const port = await server.start();
    console.log(`[awh] gateway listening on http://127.0.0.1:${port}`);
  } catch (err) {
    console.error(`[awh] gateway failed to start:`, err);
    return;
  }

  // Hello-world context-menu action: proves UI registration + command wiring.
  // Confirmed against vendor/ableton-sdk/sdk/package/dist/index.d.mts:
  // Commands.registerCommand (not .register), and registerContextMenuAction
  // returns a Promise<() => Promise<void>> (unregister function).
  try {
    ctx.commands.registerCommand("awh.hello", () => {
      console.log("[awh] hello from the context menu");
    });
    await ctx.ui.registerContextMenuAction("MidiTrack", "AWH: Hello", "awh.hello");
  } catch (err) {
    console.error(`[awh] context-menu registration failed:`, err);
  }

  // B3b: right-click "save to library" on a MIDI clip. The MidiClip scope's
  // command receives a Handle (api.md: object scopes pass a Handle); the
  // bridge resolves it with the same verified note conversion as clip reads
  // and buffers the capture in the storage outbox (the sandbox cannot write
  // into the repo) — `awh lib import` drains it later.
  try {
    ctx.commands.registerCommand("awh.saveClipToLibrary", (...args: unknown[]) => {
      void bridge
        .captureClipToOutbox(args[0] as Parameters<typeof bridge.captureClipToOutbox>[0])
        .then((name) => console.log(`[awh] captured "${name}" to the library outbox`))
        .catch((err) => console.error(`[awh] save-to-library capture failed:`, err));
    });
    await ctx.ui.registerContextMenuAction(
      "MidiClip",
      "AWH: Save clip to library",
      "awh.saveClipToLibrary",
    );
  } catch (err) {
    console.error(`[awh] save-to-library registration failed:`, err);
  }
}
