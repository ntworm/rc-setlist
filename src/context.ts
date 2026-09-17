import { type initialize } from '@ableton-extensions/sdk';

export type ExtensionContext = ReturnType<typeof initialize>;

let extensionContext: ExtensionContext | null = null;

/**
 * Returns the extension context.
 */
export function getExtensionContext(): ExtensionContext | null {
  return extensionContext;
}

/**
 * Sets the extension context.
 */
export function setExtensionContext(ctx: ExtensionContext): void {
  extensionContext = ctx;
}

/**
 * Clears the extension context.
 */
export function clearExtensionContext(): void {
  extensionContext = null;
}
