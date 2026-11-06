/**
 * Minimaler Streaming-Tokenizer für XML-Tags.
 *
 * Apple-Health-Exporte (export.xml) sind oft mehrere GB groß; ein DOM-Parser
 * würde den Speicher sprengen. Dieser Tokenizer liest Text stückweise ein und
 * meldet jedes Tag (öffnend, schließend, selbstschließend) mit seinem rohen
 * Attributtext. Textinhalt wird verworfen – den braucht der Import nicht.
 *
 * Annahme (gilt für Apple-Exporte): Attributwerte stehen in doppelten
 * Anführungszeichen. Ein `>` innerhalb eines Werts wird korrekt übersprungen.
 */

export type TagKind = 'open' | 'close' | 'empty';

export type TagHandler = (name: string, raw: string, kind: TagKind) => void;

export class XmlTagStream {
  private buf = '';

  constructor(private readonly onTag: TagHandler) {}

  push(chunk: string): void {
    this.buf += chunk;
    let pos = 0;
    const buf = this.buf;
    for (;;) {
      const lt = buf.indexOf('<', pos);
      if (lt === -1) {
        pos = buf.length;
        break;
      }
      const end = findTagEnd(buf, lt);
      if (end === -1) {
        pos = lt;
        break;
      }
      this.emit(buf.slice(lt + 1, end));
      pos = end + 1;
    }
    this.buf = buf.slice(pos);
  }

  /** Am Ende aufrufen; ein unvollständiges letztes Tag wird verworfen. */
  end(): void {
    this.buf = '';
  }

  private emit(inner: string): void {
    const c = inner.charCodeAt(0);
    if (c === 33 /* ! */ || c === 63 /* ? */) return; // Kommentar, DOCTYPE, Deklaration
    if (c === 47 /* / */) {
      this.onTag(inner.slice(1).trim(), '', 'close');
      return;
    }
    const selfClosing = inner.charCodeAt(inner.length - 1) === 47;
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const m = /^[^\s/>]+/.exec(body);
    if (!m) return;
    this.onTag(m[0], body.slice(m[0].length), selfClosing ? 'empty' : 'open');
  }
}

/** Index des schließenden `>` des Tags ab `lt`, oder -1 wenn noch unvollständig. */
function findTagEnd(buf: string, lt: number): number {
  if (buf.startsWith('<!--', lt)) {
    const e = buf.indexOf('-->', lt + 4);
    return e === -1 ? -1 : e + 2;
  }
  let from = lt + 1;
  for (;;) {
    const gt = buf.indexOf('>', from);
    if (gt === -1) return -1;
    // Liegt das `>` innerhalb eines Attributwerts? Dann ist die Anzahl der " ungerade.
    let quotes = 0;
    for (let q = buf.indexOf('"', lt); q !== -1 && q < gt; q = buf.indexOf('"', q + 1)) quotes++;
    if (quotes % 2 === 0) return gt;
    from = gt + 1;
  }
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITY[e] ?? all;
  });
}

/** Attribute aus dem rohen Tag-Text, Werte bereits dekodiert. */
export function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*"([^"]*)"/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) out[m[1]!] = decodeEntities(m[2]!);
  return out;
}
