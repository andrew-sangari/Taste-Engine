interface D1Result<T = unknown> {
  results?: T[];
  meta: { changes: number; [key: string]: unknown };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface ScheduledController {
  scheduledTime: number;
}

declare module "cloudflare:workers" {
  export type WorkflowEvent<T> = { payload: T };
  export type WorkflowStep = {
    do<T>(name: string, config: unknown, callback: () => Promise<T>): Promise<T>;
  };
  export class WorkflowEntrypoint<Env> {
    protected env: Env;
  }
}
