import { PgBoss } from "pg-boss";
import type { JobsProvider, ProviderHealth } from "./providers/contracts.js";
import { INGESTION_QUEUE, type IngestionJob } from "./ingestion.js";

export const INGESTION_JOB_OPTIONS = {
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 15 * 60,
  expireInSeconds: 15 * 60,
  heartbeatSeconds: 30,
  retentionSeconds: 30 * 24 * 60 * 60,
  deleteAfterSeconds: 30 * 24 * 60 * 60,
} as const;

export class PgBossJobsProvider implements JobsProvider {
  readonly boss: PgBoss;

  constructor(databaseUrl: string) {
    this.boss = new PgBoss({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      schema: "pgboss",
    });
  }

  async start(): Promise<this> {
    await this.boss.start();
    await this.boss.createQueue(INGESTION_QUEUE, INGESTION_JOB_OPTIONS);
    return this;
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }

  async health(): Promise<ProviderHealth> {
    try {
      return (await this.boss.isInstalled()) ? { status: "ready" } : { status: "unavailable" };
    } catch {
      return { status: "unavailable", detail: "Jobs database unavailable" };
    }
  }

  async enqueue<T>(name: string, payload: T): Promise<string> {
    const versionId = (payload as IngestionJob).versionId;
    const id = await this.boss.send(name, payload as object, {
      ...INGESTION_JOB_OPTIONS,
      singletonKey: versionId,
    });
    if (!id) throw new Error("Ingestion job could not be queued.");
    return id;
  }

  async enqueueIngestion(payload: IngestionJob): Promise<string> {
    return this.enqueue(INGESTION_QUEUE, payload);
  }
}
