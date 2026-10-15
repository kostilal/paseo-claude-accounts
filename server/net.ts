/** An abort signal that fires after `ms`. `AbortSignal.timeout` exists at runtime but is
 *  typed only by the DOM library, which this project does not load. */
export function timeoutSignal(ms: number): AbortSignal {
  return (AbortSignal as unknown as { timeout(ms: number): AbortSignal }).timeout(ms);
}
