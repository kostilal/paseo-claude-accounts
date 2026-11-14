/**
 * The events Paseo Pulse reads with a cursor (`accounts.pulse-events`, server/pulse.ts):
 * allowance windows that crossed 80 % or 95 %, and ones that reset. Kept in memory only,
 * the newest CAPACITY of them; a restart starts an empty buffer, and a cursor from before it
 * reads as a gap, so Pulse knows something may have been missed rather than hearing nothing.
 *
 * Ids are the wall clock in milliseconds, zero-padded so they sort as strings, and always one
 * more than the last: they keep their order across a restart as long as the clock does.
 */

export const PULSE_EVENTS_CAPACITY = 200;
/** How many keys are remembered for dedupe; far more than the buffer, since keys are cheap. */
const KEYS_KEPT = 1000;

export type EventFields = Record<string, string | number | boolean | null>;

export interface SourceEvent {
  id: string;
  type: string;
  /** RFC 3339: when it happened, not when it was read. */
  at: string;
  /** The entity it is about, when the event type is declared for one. */
  entity?: string;
  fields?: EventFields;
}

export interface EventsPage {
  events: SourceEvent[];
  /** The last id returned, or the point the reader has now caught up to. */
  cursor: string;
  /** The newest id kept, or "" when there is none. */
  head: string;
  /** Events newer than `after` may have been dropped: by the buffer, or with a restart. */
  gap: boolean;
}

export interface EventRing {
  /** Never throws, never awaits: safe inside the lid queue and the heat tick. A key already
   *  seen is skipped, so the same trip read again on every tick is one event. */
  push(type: string, fields: EventFields, options: { at: string; key: string; entity?: string }): void;
  read(input: { after?: string | null; limit?: number }): EventsPage;
  head(): string;
}

const idOf = (ms: number) => String(ms).padStart(15, "0");

export function createEventRing(options: { capacity?: number; now?: () => number } = {}): EventRing {
  const capacity = options.capacity ?? PULSE_EVENTS_CAPACITY;
  const now = options.now ?? Date.now;
  const events: SourceEvent[] = [];
  const keys = new Set<string>();
  let last = now();
  /** Everything at or below this id may be gone: what came before this process, then what
   *  the buffer let go. */
  let floor = idOf(last);

  return {
    push(type, fields, { at, key, entity }) {
      if (keys.has(key)) return;
      keys.add(key);
      if (keys.size > KEYS_KEPT) keys.delete(keys.values().next().value as string);
      last = Math.max(now(), last + 1);
      events.push({ id: idOf(last), type, at, ...(entity === undefined ? {} : { entity }), fields });
      while (events.length > capacity) floor = (events.shift() as SourceEvent).id;
    },

    read({ after, limit }) {
      const take = Math.max(1, Math.min(limit ?? 100, PULSE_EVENTS_CAPACITY));
      const head = events.at(-1)?.id ?? "";
      // First contact: the newest ones, oldest first, and nothing to have missed.
      if (!after) {
        const page = events.slice(-take);
        return { events: page, cursor: page.at(-1)?.id ?? "", head, gap: false };
      }
      const gap = after < floor;
      const page = events.filter((event) => event.id > after).slice(0, take);
      // Caught up past a gap with nothing new: the cursor moves to where the gap ends, or every
      // later read would report the same gap again.
      const cursor = page.at(-1)?.id ?? (gap ? floor : after);
      return { events: page, cursor, head, gap };
    },

    head: () => events.at(-1)?.id ?? "",
  };
}
