/**
 * Runs async work one call at a time, in the order it was asked for. The daemon is one process,
 * so this is enough to make a read-modify-write of the state file atomic against another one
 * going through the same queue. A failed call does not stop the ones queued after it.
 */
export function createSerial() {
  let tail: Promise<unknown> = Promise.resolve();
  return function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work, work);
    tail = run.catch(() => {});
    return run;
  };
}
