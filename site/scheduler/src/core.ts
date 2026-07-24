type WorkflowStatus = {
  status: string;
  output?: unknown;
  error?: { name?: string; message?: string };
  [key: string]: unknown;
};

type WorkflowInstance = {
  id: string;
  status(): Promise<WorkflowStatus>;
};

type WorkflowBinding = {
  create(options?: { id?: string; params?: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
};

export interface SchedulerEnv {
  TASTE_ENGINE_REFRESH_URL: string;
  TASTE_REFRESH_SECRET: string;
  TASTE_REFRESH_WORKFLOW: WorkflowBinding;
}

export async function handleManualRequest(request: Request, env: SchedulerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!authorized(request, env)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (request.method === "POST" && url.pathname === "/run") {
    const instance = await env.TASTE_REFRESH_WORKFLOW.create({
      id: `manual-${crypto.randomUUID()}`,
      params: { source: "manual", requestedAt: new Date().toISOString() },
    });
    return Response.json({
      instanceId: instance.id,
      status: await instance.status(),
    }, { status: 202 });
  }
  const match = request.method === "GET" && url.pathname.match(/^\/runs\/([^/]+)$/);
  if (match) {
    try {
      const instance = await env.TASTE_REFRESH_WORKFLOW.get(decodeURIComponent(match[1]));
      return Response.json({
        instanceId: instance.id,
        status: await instance.status(),
      });
    } catch {
      return Response.json({ error: "Workflow instance not found." }, { status: 404 });
    }
  }
  return Response.json({ error: "Not found." }, { status: 404 });
}

export async function createScheduledRun(
  env: SchedulerEnv,
  scheduledTime: number,
): Promise<WorkflowInstance> {
  return env.TASTE_REFRESH_WORKFLOW.create({
    id: `scheduled-${scheduledTime}`,
    params: { source: "cron", scheduledTime },
  });
}

export async function runRefresh(env: SchedulerEnv): Promise<Record<string, unknown>> {
  const response = await fetch(env.TASTE_ENGINE_REFRESH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.TASTE_REFRESH_SECRET}`,
      "content-type": "application/json",
      "user-agent": "taste-engine-refresh-scheduler/2.0",
    },
  });
  const payload = await response.json().catch(() => null) as {
    projectionPublished?: boolean;
    publicationBlockers?: string[];
    [key: string]: unknown;
  } | null;
  if (!response.ok || payload?.projectionPublished !== true) {
    const blocker = payload?.publicationBlockers?.[0] ?? `HTTP ${response.status}`;
    throw new Error(`Taste Engine refresh did not publish: ${blocker}`);
  }
  return payload;
}

function authorized(request: Request, env: SchedulerEnv): boolean {
  return request.headers.get("authorization") === `Bearer ${env.TASTE_REFRESH_SECRET}`;
}
