import { bridgeState } from './core/bridge-state.js';
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

export function isServerRunning(): boolean {
  return bridgeState.serverRunning;
}

export function getServer() {
  return bridgeState.server;
}

export function getCommandBus() {
  return bridgeState.commandBus;
}

export function getProfileManager() {
  return bridgeState.profileManager;
}

export function getSetlistManager() {
  return bridgeState.manager;
}

export function getAuthToken(): string {
  return bridgeState.authToken;
}

export function getOscDiagnostics(): OscDebugSnapshot | null {
  return bridgeState.oscClient?.getDebugSnapshot() ?? null;
}

export function requestOscDiagnosticProbe(): void {
  bridgeState.oscClient?.requestDiagnosticProbe();
}

export { bridgeState };
export const authToken = ''; // For backwards compatibility, though getAuthToken() is preferred
export const isCreatingTestSession = false; // For backwards compatibility
