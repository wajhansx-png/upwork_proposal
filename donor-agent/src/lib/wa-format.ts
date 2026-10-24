/**
 * WhatsApp text formatting, as a small tree (the screen turns it into elements).
 * *bold*  _italic_  ~strike~  `mono`  ```block```  "- item" / "* item" as a bullet.
 * The marks only work at word edges: not inside words (snake_case, 2*3*4) and not around spaces ("* x *"),
 * the same as in WhatsApp. Anything that does not match stays as plain text.
 */
export type WaNode =
  | { t: "text"; v: string }
  | { t: "b" | "i" | "s" | "m"; c: WaNode[] }
  | { t: "block"; v: string }
  | { t: "bullet"; c: WaNode[] }
  | { t: "br" };

const MARKS: Record<string, "b" | "i" | "s" | "m"> = { "*": "b", _: "i", "~": "s", "`": "m" };
const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined) => !ch || /\s/.test(ch);

/** One line of text, no line breaks. */
function inline(s: string): WaNode[] {
  const out: WaNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const kind = MARKS[ch];
    if (kind && !isWord(s[i - 1]) && !isSpace(s[i + 1]) && s[i + 1] !== ch) {
      let end = -1;
      for (let j = i + 2; j < s.length; j++) {
        if (s[j] === ch && !isSpace(s[j - 1]) && !isWord(s[j + 1])) {
          end = j;
          break;
        }
      }
      if (end > 0) {
        flush();
        const inner = s.slice(i + 1, end);
        out.push({ t: kind, c: kind === "m" ? [{ t: "text", v: inner }] : inline(inner) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function waFormat(text: string): WaNode[] {
  const out: WaNode[] = [];
  // ```block``` first: it can hold several lines and nothing inside it is formatted.
  const parts = text.split(/```([\s\S]*?)```/);
  parts.forEach((part, n) => {
    if (n % 2 === 1) {
      out.push({ t: "block", v: part.replace(/^\n|\n$/g, "") });
      return;
    }
    part.split("\n").forEach((line, k, all) => {
      const bullet = /^\s*[-*]\s+(\S.*)$/.exec(line);
      if (bullet) out.push({ t: "bullet", c: inline(bullet[1]) });
      else {
        out.push(...inline(line));
        // A line break after a text line (a bullet is a block of its own and needs none).
        if (k < all.length - 1) out.push({ t: "br" });
      }
    });
  });
  return out;
}

/** A line as the reader sees it: no marks, no bullet sign, single spaces. */
export const plainLine = (l: string) => l.replace(/^\s*[-*]\s+/, "").replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();

/**
 * Which raw lines a selection on the preview covers. The preview shows text without the marks, so the selected
 * words are matched against each line without its marks. Null when the selection is not in the message.
 */
export function linesOf(raw: string, selected: string): { from: number; to: number } | null {
  const lines = raw.split("\n");
  const parts = selected.split("\n").map((s) => s.replace(/[•]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!parts.length) return null;
  const find = (frag: string, start: number) => {
    for (let i = start; i < lines.length; i++) if (plainLine(lines[i]).includes(frag)) return i;
    return -1;
  };
  const from = find(parts[0], 0);
  if (from < 0) return null;
  const to = parts.length > 1 ? find(parts[parts.length - 1], from) : from;
  return to < 0 ? null : { from, to };
}
