/**
 * Public-build boundary for the private Ableton Extensions SDK types.
 * Production builds resolve the authorized SDK package instead of this file.
 */
export type ActivationContext = unknown;

export declare function initialize(
  activation: ActivationContext,
  apiVersion: string,
): any;
