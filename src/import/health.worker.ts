/// <reference lib="webworker" />
import { buildHealthImport } from './health';
import { readHealthExport } from './readExport';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { file, rules, sleepSource } = e.data;
  const post = (msg: WorkerResponse) => self.postMessage(msg);
  try {
    const raw = await readHealthExport(file.stream(), {
      totalBytes: file.size,
      collect: { sleepSource },
      onProgress: (ratio) => post({ type: 'progress', ratio }),
    });
    post({ type: 'done', result: buildHealthImport(raw, rules) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
