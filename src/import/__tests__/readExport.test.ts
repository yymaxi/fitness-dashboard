import { describe, expect, it } from 'vitest';
import { strToU8, zipSync, Zip, ZipDeflate } from 'fflate';
import { readHealthExport } from '../readExport';
import { buildHealthImport } from '../health';
import { sleep, steps, wrap } from './fixture';

const xml = wrap([
  sleep('Zepp', 'AsleepCore', '2026-11-05 23:00:00 +0100', '2026-11-06 06:30:00 +0100'),
  ...Array.from({ length: 500 }, (_, i) => steps('iPhone', '2026-11-06 08:00:00 +0100', '2026-11-06 08:01:00 +0100', i % 2 ? 10 : 20)),
].join('\n'));

/** Datei in kleinen Stücken liefern, wie File.stream() es tut. */
function streamOf(bytes: Uint8Array, chunk = 997): ReadableStream<Uint8Array> {
  let pos = 0;
  return new ReadableStream({
    pull(c) {
      if (pos >= bytes.length) return c.close();
      c.enqueue(bytes.slice(pos, pos + chunk));
      pos += chunk;
    },
  });
}

/** Zip wie von iOS: Einträge per Streaming geschrieben (Größen erst im Data Descriptor). */
function streamingZip(files: Record<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  for (const [name, data] of Object.entries(files)) {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(data, true);
  }
  zip.end();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('readHealthExport', () => {
  const check = async (bytes: Uint8Array) => {
    const ratios: number[] = [];
    const raw = await readHealthExport(streamOf(bytes), { totalBytes: bytes.length, onProgress: (r) => ratios.push(r) });
    const result = buildHealthImport(raw, []);
    expect(result.sleepNights.map((n) => n.asleepMin)).toEqual([450]);
    expect(result.dailyVitals[0]?.steps).toBe(7500);
    expect(ratios.at(-1)).toBe(1);
  };

  it('liest eine reine export.xml', () => check(strToU8(xml)));

  it('liest export.zip und ignoriert export_cda.xml', () =>
    check(
      zipSync({
        'apple_health_export/export_cda.xml': strToU8('<Record type="HKQuantityTypeIdentifierStepCount" sourceName="X" startDate="2026-11-06 08:00:00 +0100" value="99999"/>'),
        'apple_health_export/export.xml': strToU8(xml),
      }),
    ));

  it('liest gestreamte Zips mit Data Descriptor', () => check(streamingZip({ 'apple_health_export/export.xml': strToU8(xml) })));

  it('meldet einen Fehler, wenn das Zip keine export.xml enthält', async () => {
    await expect(readHealthExport(streamOf(zipSync({ 'foo.txt': strToU8('x') })))).rejects.toThrow(/export\.xml/);
  });
});
