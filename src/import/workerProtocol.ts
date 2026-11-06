import type { ImportRule } from '../data/db';
import type { HealthImport } from './health';

export interface WorkerRequest {
  file: File;
  rules: ImportRule[];
  sleepSource: string;
}

export type WorkerResponse =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; result: HealthImport }
  | { type: 'error'; message: string };

/** Startet den Import im Web Worker, damit die Oberfläche flüssig bleibt. */
export function runHealthImportWorker(req: WorkerRequest, onProgress: (ratio: number) => void): Promise<HealthImport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./health.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') return onProgress(msg.ratio);
      worker.terminate();
      if (msg.type === 'done') resolve(msg.result);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Import fehlgeschlagen'));
    };
    worker.postMessage(req);
  });
}
