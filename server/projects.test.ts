import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaseoApi } from "@getpaseo/client";
import { createProjects, type ProjectRow } from "./projects.ts";

const projects: ProjectRow[] = [
  { id: "acme", name: "Acme", path: "/Users/me/Work/acme" },
  { id: "site", name: "site", path: "/Users/me/Work/site" },
];

function fakePaseo(list: () => Array<ProjectRow & { custom?: string }>): PaseoApi {
  return {
    projects: {
      list: async () => ({
        projects: list().map((row) => ({
          projectId: row.id,
          projectCustomName: row.custom ?? "",
          projectDisplayName: row.name,
          projectRootPath: row.path,
        })),
      }),
    },
  } as unknown as PaseoApi;
}

test("projects are listed with their id, name and root path", async () => {
  const rows = await createProjects().list(fakePaseo(() => projects));
  assert.deepEqual(rows, projects);
});

test("a custom name wins over the display name", async () => {
  const rows = await createProjects().list(
    fakePaseo(() => [{ id: "acme", name: "acme", custom: "Acme Corp", path: "/Users/me/Work/acme" }]),
  );
  assert.equal(rows[0]?.name, "Acme Corp");
});

test("the project list is cached, and invalidate drops it", async () => {
  let listed = 0;
  const paseo = fakePaseo(() => {
    listed += 1;
    return projects;
  });
  const cache = createProjects();
  await cache.list(paseo);
  await cache.list(paseo);
  assert.equal(listed, 1);
  cache.invalidate();
  await cache.list(paseo);
  assert.equal(listed, 2);
});

test("an expired cache is read again", async () => {
  let listed = 0;
  const paseo = fakePaseo(() => {
    listed += 1;
    return projects;
  });
  const cache = createProjects(0);
  await cache.list(paseo);
  await new Promise((resolve) => setTimeout(resolve, 2));
  await cache.list(paseo);
  assert.equal(listed, 2);
});
