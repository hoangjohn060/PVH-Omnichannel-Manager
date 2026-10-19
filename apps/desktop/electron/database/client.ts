import { Worker } from 'node:worker_threads';
import { join } from 'node:path';

export class DatabaseClient {
  private worker: Worker;
  private nextId = 0;
  private failure?: Error;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  readonly ready: Promise<void>;
  constructor(directory: string) {
    this.worker = new Worker(join(__dirname, 'database-worker.js'), { workerData: { directory } });
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', (message: { ready?: boolean; id: number; ok: boolean; data: unknown; error: string }) => {
        if (message.ready) { resolve(); return; }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.data); else pending.reject(new Error(message.error));
      });
      this.worker.on('error', error => { reject(error); this.failAll(error); });
      this.worker.on('exit', code => { const error = new Error(`Database worker exited (${code})`); reject(error); this.failAll(error); });
    });
  }
  private failAll(error: Error): void {
    this.failure = error;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(error); }
    this.pending.clear();
  }
  async call<T>(method: string, payload?: unknown): Promise<T> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.pending.size >= 512) throw new Error('DATABASE_QUEUE_FULL');
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Database operation timed out')); }, 60_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker.postMessage({ id, method, payload }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async close(): Promise<void> { try { await this.call('close'); } finally { await this.worker.terminate(); } }
}