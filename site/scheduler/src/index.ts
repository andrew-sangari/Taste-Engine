import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  createScheduledRun,
  handleManualRequest,
  runRefresh,
  type SchedulerEnv,
} from "./core";

export class TasteEngineRefreshWorkflow extends WorkflowEntrypoint<SchedulerEnv> {
  async run(_event: WorkflowEvent<unknown>, step: WorkflowStep) {
    return step.do(
      "refresh Taste Engine",
      {
        retries: {
          limit: 10,
          delay: "5 minutes",
          backoff: "constant",
        },
        timeout: "30 minutes",
      },
      () => runRefresh(this.env),
    );
  }
}

const scheduler = {
  async scheduled(controller: ScheduledController, env: SchedulerEnv): Promise<void> {
    await createScheduledRun(env, controller.scheduledTime);
  },

  fetch(request: Request, env: SchedulerEnv): Promise<Response> {
    return handleManualRequest(request, env);
  },
};

export default scheduler;
