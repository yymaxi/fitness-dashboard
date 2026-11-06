import { describe, expect, it } from 'vitest';
import { decodeEntities, parseAttrs, XmlTagStream, type TagKind } from '../xmlStream';
import { wrap } from './fixture';

function tokenize(chunks: string[]) {
  const out: [string, TagKind, string][] = [];
  const s = new XmlTagStream((name, raw, kind) => out.push([name, kind, raw]));
  for (const c of chunks) s.push(c);
  s.end();
  return out;
}

describe('XmlTagStream', () => {
  const xml = wrap('<Record a="1 > 2" b="x"/>\n<Workout t="Run"><WorkoutStatistics sum="5"/></Workout>');

  it('erkennt Tags und überspringt Deklaration, DOCTYPE und Kommentare', () => {
    const tags = tokenize([xml]).map(([n, k]) => `${k}:${n}`);
    expect(tags).toEqual([
      'open:HealthData', 'empty:ExportDate', 'empty:Me', 'empty:Record',
      'open:Workout', 'empty:WorkoutStatistics', 'close:Workout', 'close:HealthData',
    ]);
  });

  it('liefert dasselbe Ergebnis bei beliebiger Stückelung', () => {
    const whole = tokenize([xml]);
    for (const size of [1, 2, 3, 7, 64]) {
      const chunks: string[] = [];
      for (let i = 0; i < xml.length; i += size) chunks.push(xml.slice(i, i + size));
      expect(tokenize(chunks)).toEqual(whole);
    }
  });

  it('dekodiert Attribute samt Entities, auch mit > im Wert', () => {
    const rec = tokenize([xml]).find(([n]) => n === 'Record')!;
    expect(parseAttrs(rec[2])).toEqual({ a: '1 > 2', b: 'x' });
    expect(decodeEntities('Max&apos;s &lt;Watch&gt; &amp; &#228;&#x00FC;')).toBe("Max's <Watch> & äü");
  });
});
