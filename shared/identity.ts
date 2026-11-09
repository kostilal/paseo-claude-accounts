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

/** Whose allowance a login is: the organisation of a team or enterprise seat, or `personal`
 *  for the person's own (Claude names that org "<email>'s Organization", Codex "Personal").
 *  "" when it is not known: a blank org may be a seat whose org was not read, so it is never
 *  guessed to be personal. */
export function loginOwner(login: { email: string; orgName: string }, personal: string): string {
  const org = login.orgName.trim();
  if (login.email === "" || org === "") return "";
  const lower = org.toLowerCase();
  if (lower.includes(login.email.toLowerCase()) || lower === "personal") return personal;
  return org;
}

/** A row's one-line title, the owner first: one address can hold the person's own plan and a
 *  company seat, and a row too narrow for the whole title must still say whose it is. The
 *  address alone when the owner is unknown; with no address, the org, then `fallback`. */
export function loginName(login: { email: string; orgName: string }, personal: string, fallback: string): string {
  if (login.email === "") return login.orgName !== "" ? login.orgName : fallback;
  const owner = loginOwner(login, personal);
  return owner === "" ? login.email : `${owner} · ${login.email}`;
}
