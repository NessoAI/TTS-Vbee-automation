import fs from 'node:fs/promises';
import path from 'node:path';
import type { Job } from '../../shared/types.js';

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly directory = path.resolve(process.cwd(), 'data/jobs');

  async init(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of await fs.readdir(this.directory)) {
      if (!name.endsWith('.json')) continue;
      try {
        const job = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')) as Job;
        this.jobs.set(job.id, job);
      } catch { /* ignore a corrupt recovery file */ }
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Không tìm thấy job ${id}.`);
    return job;
  }

  async save(job: Job): Promise<Job> {
    job.updatedAt = new Date().toISOString();
    this.jobs.set(job.id, job);
    await fs.writeFile(path.join(this.directory, `${job.id}.json`), JSON.stringify(job, null, 2));
    return job;
  }
}
