import assert from "node:assert/strict";
import test from "node:test";
import {
  createScheduledRun,
  handleManualRequest,
  runRefresh,
} from "../scheduler/src/core.ts";

test("manual scheduler endpoint requires the refresh secret", async () => {
  const response = await handleManualRequest(
    new Request("https://scheduler.example/run", { method: "POST" }),
    environment(),
  );
  assert.equal(response.status, 401);
});

test("manual scheduler endpoint durably enqueues and reports a refresh", async () => {
  const instances = new Map();
  const env = environment(instances);
  const response = await handleManualRequest(
    new Request("https://scheduler.example/run", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    }),
    env,
  );
  assert.equal(response.status, 202);
  const queued = await response.json();
  assert.match(queued.instanceId, /^manual-/);
  assert.equal(queued.status.status, "queued");

  instances.set(queued.instanceId, {
    id: queued.instanceId,
    status: async () => ({ status: "complete", output: { projectionPublished: true } }),
  });
  const status = await handleManualRequest(
    new Request(`https://scheduler.example/runs/${queued.instanceId}`, {
      headers: { authorization: "Bearer secret" },
    }),
    env,
  );
  assert.equal(status.status, 200);
  assert.equal((await status.json()).status.status, "complete");
});

test("cron enqueue uses a deterministic scheduled instance id", async () => {
  const instance = await createScheduledRun(environment(), 123456);
  assert.equal(instance.id, "scheduled-123456");
});

test("workflow step invokes and returns the hosted refresh", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://taste.example/refresh");
    assert.equal(init.headers.authorization, "Bearer secret");
    return Response.json({ projectionPublished: true, runId: "run-1" });
  };
  try {
    assert.deepEqual(await runRefresh(environment()), {
      projectionPublished: true,
      runId: "run-1",
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

function environment(instances = new Map()) {
  return {
    TASTE_ENGINE_REFRESH_URL: "https://taste.example/refresh",
    TASTE_REFRESH_SECRET: "secret",
    TASTE_REFRESH_WORKFLOW: {
      async create(options = {}) {
        const instance = {
          id: options.id ?? "generated",
          status: async () => ({ status: "queued" }),
        };
        instances.set(instance.id, instance);
        return instance;
      },
      async get(id) {
        const instance = instances.get(id);
        if (!instance) throw new Error("missing");
        return instance;
      },
    },
  };
}
