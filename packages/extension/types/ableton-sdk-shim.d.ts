/**
 * MINIMAL type shim for @ableton-extensions/sdk, used ONLY for typechecking in
 * environments without the SDK (CI, containers). The real SDK (from
 * vendor/ableton-sdk/, never committed) is what esbuild bundles on the dev
 * machine — `pnpm setup:sdk` extracts it and the build fails loudly if absent.
 *
 * VERIFY-ON-MACHINE: every declaration below is a best-effort reconstruction
 * from the public API reference. On first build with the real SDK, diff this
 * file against the SDK's own .d.ts (and the aker-dev skill's verified
 * reference) and correct any drift. Keep this shim to exactly the surface
 * src/main.ts uses — it is not an SDK reference.
 */
declare module "@ableton-extensions/sdk" {
  export interface ActivationContext {
    readonly [key: string]: unknown;
  }

  export interface Song {
    getTempo(): number;
    getTracks(): unknown[];
    getScenes(): unknown[];
  }

  export interface Environment {
    readonly storageDirectory: string;
    readonly tempDirectory: string;
  }

  export interface Ui {
    registerContextMenuAction(
      scope: string,
      title: string,
      commandId: string,
    ): () => void;
  }

  export interface Commands {
    register(commandId: string, handler: (payload?: unknown) => void): void;
  }

  export interface ExtensionContext {
    readonly song: Song;
    readonly environment: Environment;
    readonly ui: Ui;
    readonly commands: Commands;
    withinTransaction<T>(fn: () => T): T;
  }

  export function initialize(
    activationContext: ActivationContext,
    apiVersion: string,
  ): Promise<ExtensionContext>;
}
