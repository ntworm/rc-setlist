import { bridgeState } from './runtime/bridge-state.js';
import type { OscDebugSnapshot } from './integration/osc-client.js';
import type { ProjectIdentity } from './core/project-identity.js';

export interface StartServerOptions {
  port?: number;
  skipOsc?: boolean;
  skipCerts?: boolean;
  skipProjectDetector?: boolean;
  projectIdentity?: ProjectIdentity;
}

export { startServer, stopServer } from './server-lifecycle.js';

/**
 * Reports whether the server running matches the contract.
 */
export function isServerRunning(): boolean {
  return bridgeState.serverRunning;
}

/**
 * Returns the server.
 */
export function getServer() {
  return bridgeState.server;
}

/**
 * Returns the command bus.
 */
export function getCommandBus() {
  return bridgeState.commandBus;
}

/**
 * Returns the profile manager.
 */
export function getProfileManager() {
  return bridgeState.profileManager;
}

/**
 * Returns the setlist manager.
 */
export function getSetlistManager() {
  return bridgeState.manager;
}

/**
 * Returns the auth token.
 */
export function getAuthToken(): string {
  return bridgeState.authToken;
}

/**
 * Returns the osc diagnostics.
 */
export function getOscDiagnostics(): OscDebugSnapshot | null {
  return bridgeState.oscClient?.getDebugSnapshot() ?? null;
}

/**
 * RequestOscDiagnosticProbe — implementation detail.
 */
export function requestOscDiagnosticProbe(): void {
  bridgeState.oscClient?.requestDiagnosticProbe();
}

export { bridgeState };
export const authToken = ''; // For backwards compatibility, though getAuthToken() is preferred
export const isCreatingTestSession = false; // For backwards compatibility
