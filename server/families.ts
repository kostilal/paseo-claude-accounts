import { bounded } from "./bounded.ts";
import type { PaseoApi } from "./paseo.ts";
import { type ProviderFamily, familyOf, isProviderId, providerFamilies } from "../shared/providers.ts";

/**
 * The custom providers that extend Claude, read from Paseo's config and cached for a minute. A
 * provider missing from the cache is read again (at most every few seconds), so a profile
 * added a moment ago is found; an unreadable config, or one that does not answer within `readMs`,
 * reads as the last known profiles, never as an error: a session opening waits on this.
 */
export function createFamilies(ttlMs = 60_000, missMs = 5_000, readMs = 3_000) {
  let cached: { at: number; value: Record<string, ProviderFamily> } | null = null;

  /** The config as it is now; rejects when it cannot be read, for a caller that can ask again. */
  async function read(paseo: PaseoApi): Promise<Record<string, ProviderFamily>> {
    // Claude's only: the pill, the only way to see or change a chat's account, is Claude's
    // alone, so the hook and "move all chats" leave other profiles as Paseo runs them.
    const found = providerFamilies((await paseo.config.get()).config);
    const value = Object.fromEntries(Object.entries(found).filter(([, entry]) => entry.family === "claude"));
    cached = { at: Date.now(), value };
    return value;
  }

  async function all(paseo: PaseoApi, fresh = false): Promise<Record<string, ProviderFamily>> {
    if (!fresh && cached !== null && Date.now() - cached.at < ttlMs) return cached.value;
    const answered = await bounded(read(paseo), readMs, null);
    if (answered !== null) return answered;
    const value = cached?.value ?? {};
    cached = { at: Date.now(), value };
    return value;
  }

  async function of(paseo: PaseoApi, provider: string): Promise<ProviderFamily | null> {
    if (isProviderId(provider)) return familyOf(provider, {});
    const known = familyOf(provider, await all(paseo));
    if (known !== null || (cached !== null && Date.now() - cached.at < missMs)) return known;
    return familyOf(provider, await all(paseo, true));
  }

  return {
    all,
    read,
    of,
    /** The provider a chat of `provider` counts as where accounts are concerned: the one a
     *  profile extends, else `provider` itself. */
    name: async (paseo: PaseoApi, provider: string): Promise<string> => (await of(paseo, provider))?.family ?? provider,
  };
}
