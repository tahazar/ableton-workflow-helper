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
}
