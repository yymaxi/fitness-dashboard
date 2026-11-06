import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { DEFAULT_COLLECT_OPTIONS, HealthCollector, type CollectOptions, type HealthRaw } from './health';
import { XmlTagStream } from './xmlStream';

export interface ReadOptions {
  /** Gesamtgröße der Eingabe in Bytes, für die Fortschrittsanzeige. */
  totalBytes?: number;
  onProgress?: (ratio: number) => void;
  collect?: CollectOptions;
}

/** export.xml im Zip (nicht export_cda.xml), egal in welchem Ordner. */
export const isExportXml = (name: string) => /(^|\/)export\.xml$/i.test(name);

/**
 * Liest einen Apple-Health-Export (export.zip oder export.xml) als Stream.
 * Es liegt nie die ganze Datei im Speicher: Zip → Inflate → Text → Tags →
 * Sammler laufen Stück für Stück.
 */
export async function readHealthExport(stream: ReadableStream<Uint8Array>, opts: ReadOptions = {}): Promise<HealthRaw> {
  const collector = new HealthCollector(opts.collect ?? DEFAULT_COLLECT_OPTIONS);
  const xml = new XmlTagStream(collector.onTag);
  const decoder = new TextDecoder('utf-8');
  const feedXml = (bytes: Uint8Array) => xml.push(decoder.decode(bytes, { stream: true }));

  const reader = stream.getReader();
  let first = true;
  let unzip: Unzip | null = null;
  let foundXml = false;
  let unzipError: Error | null = null;
  let read = 0;
  let lastReport = 0;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (first) {
      first = false;
      // Zip-Signatur „PK\x03\x04“ – sonst als reines XML behandeln
      if (value[0] === 0x50 && value[1] === 0x4b) {
        unzip = new Unzip((file: UnzipFile) => {
          if (foundXml || !isExportXml(file.name)) return;
          foundXml = true;
          file.ondata = (err, data) => {
            if (err) unzipError = err;
            else feedXml(data);
          };
          file.start();
        });
        unzip.register(UnzipInflate);
      }
    }
    if (unzip) unzip.push(value, false);
    else feedXml(value);
    if (unzipError) throw unzipError;

    read += value.byteLength;
    if (opts.onProgress && opts.totalBytes && read - lastReport > 1 << 20) {
      lastReport = read;
      opts.onProgress(Math.min(1, read / opts.totalBytes));
    }
    // Dem Event-Loop Luft lassen (Abbruch, Fortschrittsmeldungen)
    await Promise.resolve();
  }
  if (unzip) {
    unzip.push(new Uint8Array(0), true);
    if (unzipError) throw unzipError;
    if (!foundXml) throw new Error('Im Zip wurde keine export.xml gefunden.');
  }
  xml.push(decoder.decode());
  xml.end();
  opts.onProgress?.(1);
  return collector.raw;
}
