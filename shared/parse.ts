export interface Identity {
  loggedIn: boolean;
  email: string;
  orgName: string;
  subscriptionType: string;
}

export interface Bar {
  utilization: number;
  resetsAt: string;
}

export interface Meter {
  fiveHour: Bar | null;
  sevenDay: Bar | null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Turns any non-object `JSON.parse` result (`null`, `42`, an array) into `{}`, so callers
 *  can read properties without their own checks. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Output of `claude auth status --json`. Unknown fields are ignored. */
export function parseAuthStatus(raw: string): Identity {
  const body = record(JSON.parse(raw));
  return {
    loggedIn: body.loggedIn === true,
    email: str(body.email),
    orgName: str(body.orgName),
    subscriptionType: str(body.subscriptionType),
  };
}

function bar(value: unknown): Bar | null {
  if (typeof value !== "object" || value === null) return null;
  const window = value as Record<string, unknown>;
  if (typeof window.utilization !== "number") return null;
  return { utilization: window.utilization, resetsAt: str(window.resets_at) };
}

/** Body of `GET /api/oauth/usage`; `utilization` is a percentage, 0–100. An error body
 *  just has no windows; the caller handles 401 by status code. */
export function parseUsage(raw: string): Meter {
  const body = record(JSON.parse(raw));
  return { fiveHour: bar(body.five_hour), sevenDay: bar(body.seven_day) };
}
