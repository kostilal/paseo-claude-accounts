/** A login is an account (what a subscription's allowance belongs to), not a config
 *  directory. Several directories can be logged into the same account, and switching between
 *  them changes nothing about which allowance a chat spends. */
export interface Login {
  key: string;
  email: string;
  orgName: string;
  /** `Identity.subscriptionType`. */
  plan: string;
}

/** Two directories are one login when they report the same `email` under the same `orgName`;
 *  the same address under another org is a different allowance. A directory with no email
 *  keys on its own `home`, so anonymous directories are never merged. JSON-encoded tagged
 *  arrays keep fields and branches from colliding. */
export function loginKey(identity: { email: string; orgName: string }, home: string): string {
  if (identity.email === "") return JSON.stringify(["home", home]);
  return JSON.stringify(["login", identity.email, identity.orgName]);
}

/** `email · orgName · plan`, skipping blank parts and parts that contain an earlier one
 *  (personal accounts get an org named "<email>'s Organization", which would repeat the
 *  address). Returns `fallback` when nothing is known, so a label is never empty. */
export function loginLabel(login: { email: string; orgName: string; plan: string }, fallback: string): string {
  const parts: string[] = [];
  for (const part of [login.email, login.orgName, login.plan]) {
    if (part === "" || parts.some((kept) => part.includes(kept))) continue;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join(" · ") : fallback;
}
