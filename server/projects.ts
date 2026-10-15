import type { PaseoApi } from "@getpaseo/client";

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
}

/** Paseo's projects, cached for a minute: they change when somebody adds one. */
export function createProjects(ttlMs = 60_000) {
  let cached: { at: number; rows: ProjectRow[] } | null = null;

  async function list(paseo: PaseoApi): Promise<ProjectRow[]> {
    if (cached !== null && Date.now() - cached.at < ttlMs) return cached.rows;
    const answer = await paseo.projects.list();
    const rows = answer.projects.map((entry) => ({
      id: entry.projectId,
      name: entry.projectCustomName || entry.projectDisplayName,
      path: entry.projectRootPath,
    }));
    cached = { at: Date.now(), rows };
    return rows;
  }

  return { list, invalidate: () => (cached = null) };
}
