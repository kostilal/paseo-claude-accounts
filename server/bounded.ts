/**
 * The work's answer, or `fallback` when it takes longer than `ms` or fails. The work is not
 * cancelled: a late answer is dropped, but whatever it cached on the way stays cached. The timer
 * is cleared as soon as the work answers, so it never outlives the call.
 */
export function bounded<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work.catch(() => fallback), gaveUp]).finally(() => clearTimeout(timer));
}
