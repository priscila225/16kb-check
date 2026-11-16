/**
 * A small, forgiving XML reader for AndroidManifest.xml and res/values files.
 * Element and attribute names keep their prefix (for example "android:name").
 * Text content is kept only as `text` on leaf elements (enough for <item>true</item>).
 */
export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse an XML document. Returns a synthetic "#document" root whose children are the top-level elements. */
export function parseXml(input: string): XmlElement {
  const text = input.replace(/^\uFEFF/, "");
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decodeEntities(text.slice(i, lt));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      stack[stack.length - 1].text += text.slice(lt + 9, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith("<!", lt)) {
      // DOCTYPE and friends. Skip a possible internal subset in brackets.
      let depth = 0;
      let j = lt + 2;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    // Find the end of the tag, respecting quoted attribute values.
    let j = lt + 1;
    let quote = "";
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    const raw = text.slice(lt + 1, j);
    i = j + 1;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      // Pop to the matching element; tolerate stray closing tags.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^\s*([^\s/>]+)/.exec(body);
    if (!nameMatch) continue;
    const el: XmlElement = { name: nameMatch[1], attrs: {}, children: [], text: "" };
    const rest = body.slice(nameMatch[0].length);
    for (const m of rest.matchAll(ATTR)) el.attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c) => c.name === name);
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => c.name === name);
}
