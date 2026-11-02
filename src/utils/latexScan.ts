/**
 * A small, forgiving LaTeX reader for the template importer. It doesn't
 * typeset anything: it finds structure (commands, groups, environments, lists)
 * and the runs of plain text a reader would see, with their positions, so the
 * importer can swap text for placeholders without disturbing the layout.
 */

export interface Range {
  start: number;
  end: number;
}

const isLetter = (c: string | undefined) => !!c && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));

export function lineEnd(src: string, i: number): number {
  const j = src.indexOf("\n", i);
  return j === -1 ? src.length : j;
}

/** Index just past the `{…}` or `[…]` group that opens at src[i]. */
export function matchGroup(src: string, i: number, limit = src.length): number {
  const open = src[i];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < limit; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "%") {
      j = lineEnd(src, j);
      continue;
    }
    if (open === "[" && c === "{") {
      j = matchGroup(src, j, limit) - 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return limit;
}

/** Skips spaces, single line breaks and comments, but not a blank line (a paragraph break). */
export function skipFiller(src: string, i: number, end = src.length): number {
  while (i < end) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") i++;
    else if (c === "%") i = lineEnd(src, i) + 1;
    else if (c === "\n") {
      let j = i + 1;
      while (j < end && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
      if (src[j] === "\n") return i;
      i = j;
    } else break;
  }
  return Math.min(i, end);
}

/** Skips `n` brace arguments (and any optional `[…]` arguments between them). */
export function skipArgs(src: string, i: number, n: number, end = src.length): number {
  let j = i;
  let taken = 0;
  while (taken < n) {
    const k = skipFiller(src, j, end);
    if (src[k] === "[") {
      j = matchGroup(src, k, end);
      continue;
    }
    if (src[k] !== "{") break;
    j = matchGroup(src, k, end);
    taken++;
  }
  return j;
}

/** Brace arguments that follow a command, as inner ranges. */
export function readArgs(
  src: string,
  i: number,
  max: number,
  end = src.length,
  optional = false
): { args: Range[]; end: number } {
  let j = i;
  const args: Range[] = [];
  if (optional) {
    const k = skipFiller(src, j, end);
    if (src[k] === "[") j = matchGroup(src, k, end);
  }
  while (args.length < max) {
    const k = skipFiller(src, j, end);
    if (src[k] !== "{") break;
    const close = matchGroup(src, k, end);
    args.push({ start: k + 1, end: close - 1 });
    j = close;
  }
  return { args, end: j };
}

/* ---------- Commands the reader knows ---------- */

/** Commands whose arguments are settings, not text. */
const SKIP_ARGS: Record<string, number> = {
  vspace: 1, hspace: 1, addvspace: 1, setlength: 2, addtolength: 2, color: 1, textcolor: 1,
  colorbox: 1, fcolorbox: 2, pagecolor: 1, definecolor: 3, fontsize: 2, fontfamily: 1,
  fontseries: 1, fontshape: 1, includegraphics: 1, label: 1, ref: 1, pageref: 1, cite: 1,
  input: 1, include: 1, usepackage: 1, pagestyle: 1, thispagestyle: 1, setcounter: 2,
  addtocounter: 2, multicolumn: 2, multirow: 2, faIcon: 1, hypersetup: 1, urlstyle: 1,
  setlist: 1, linespread: 1, geometry: 1, raisebox: 1, rule: 2, phantom: 1, hphantom: 1,
  vphantom: 1, makebox: 0, parbox: 1, resizebox: 2, scalebox: 1, titlespacing: 5,
  newgeometry: 1, enlargethispage: 1, extracolsep: 1, setmainfont: 1, setsansfont: 1,
  hyphenation: 1, columnratio: 1, setcolumnwidth: 1,
};

/** Definitions in the body: skip every argument that follows. */
const SKIP_ALL = new Set(["newcommand", "renewcommand", "providecommand", "def", "newenvironment", "renewenvironment", "titleformat", "DeclareRobustCommand", "let"]);

/** Commands followed by a bare dimension (`\vskip 4pt`). */
const DIMENSION_CMDS = new Set(["vskip", "hskip", "kern", "baselineskip", "parskip", "parindent", "tabcolsep", "arraystretch"]);
const DIMENSION = /^\s*=?\s*-?[\d.]+\s*(pt|em|ex|in|cm|mm|bp|sp|pc|\\[a-zA-Z]+)?/;

/** Arguments of `\begin{env}` that are settings (column specs, widths). */
const ENV_ARGS: Record<string, number> = {
  tabular: 1, "tabular*": 2, tabularx: 2, tabulary: 2, longtable: 1, minipage: 1, multicols: 1,
  "multicols*": 1, adjustwidth: 2, paracol: 1, tabu: 1, wrapfigure: 2, spacing: 1, list: 2,
};

/** What a symbol command reads as. Every one of them ends a run of text. */
const TEXT_SYMBOLS: Record<string, string> = {
  textbar: " | ", textbullet: " • ", bullet: " • ", cdot: " · ", cdotp: " · ", hfill: " ", hfil: " ",
  quad: " ", qquad: " ", enspace: " ", thinspace: " ", ldots: "…", dots: "…", textendash: " – ",
  textemdash: " — ", LaTeX: "LaTeX", TeX: "TeX", newline: " ", linebreak: " ", par: "\n\n",
  item: "\n", textasciitilde: "~", textless: "<", textgreater: ">", slash: "/", vert: " | ",
  textbackslash: "\\", space: " ", noindent: "", centering: "", raggedright: "", raggedleft: "",
};

/** Commands that are only formatting; they never start an entry. */
export const FORMATTING_CMDS = new Set([
  "textbf", "textit", "emph", "underline", "textsc", "texttt", "textsf", "textrm", "textup", "textmd",
  "textsl", "mbox", "uline", "href", "url", "small", "footnotesize", "scriptsize", "tiny", "large",
  "Large", "LARGE", "huge", "Huge", "normalsize", "bfseries", "itshape", "scshape", "item",
  "hfill", "vspace", "hspace", "textcolor", "color", "fontsize", "selectfont", "setlength",
  "addtolength", "multicolumn", "multirow", "rule", "raisebox", "makebox", "parbox", "framebox",
  "resizebox", "scalebox", "begin", "end", "newcommand", "renewcommand", "titleformat",
  "titlespacing", "frac", "colorbox", "fcolorbox", "definecolor", "footnote", "section",
  "subsection", "subsubsection", "paragraph", "centerline", "includegraphics", "setcounter",
  "faIcon", "label", "ref", "cite", "input", "phantom", "smallskip", "medskip", "bigskip",
  "noindent", "par", "newline", "linebreak", "pagebreak", "newpage", "clearpage", "quad", "qquad",
]);

const ACCENT_MARKS: Record<string, string> = {
  "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇",
};

const MATH_SYMBOLS: Record<string, string> = {
  sim: "~", approx: "≈", times: "×", rightarrow: "→", to: "→", leftarrow: "←", pm: "±", cdot: "·",
  bullet: "•", vert: "|", mid: "|", geq: "≥", leq: "≤", ge: "≥", le: "≤", circ: "°", star: "*",
  infty: "∞", ast: "*", diamond: "◇", Rightarrow: "⇒", uparrow: "↑", downarrow: "↓",
};

/** Plain text of inline math (`$|$` → "|", `$\sim$10` → "~10"). */
function mathText(inner: string): string {
  return inner
    .replace(/\\([a-zA-Z]+)\s*/g, (_m, name: string) => MATH_SYMBOLS[name] ?? "")
    .replace(/\\(.)/g, "$1")
    .replace(/[{}^_]/g, "")
    .trim();
}

/** Turns a raw run of LaTeX text (no commands left in it) into what it reads as. */
export function decodeText(raw: string): string {
  return raw
    .replace(/\\([`'^"~=.])\s*(?:\{([a-zA-Z])\}|([a-zA-Z]))/g, (_m, accent: string, a?: string, b?: string) =>
      ((a || b || "") + ACCENT_MARKS[accent]).normalize("NFC")
    )
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\[-@/]/g, "")
    .replace(/\\[ ,;:!]/g, " ")
    .replace(/~/g, " ")
    .replace(/``|''/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- The document's own vocabulary ---------- */

export interface MacroInfo {
  args: number;
  optional: boolean;
  body: string;
}

export interface Lexicon {
  macros: Map<string, MacroInfo>;
  /** Environments that are bullet lists (itemize, plus ones the file defines on top of it). */
  listEnvs: Set<string>;
  /** Macros that open / close a list (e.g. `\resumeItemListStart`). */
  listStart: Set<string>;
  listEnd: Set<string>;
  /** One-argument macros that print a bullet (e.g. `\resumeItem{…}`). */
  bulletMacros: Set<string>;
  /** Commands that print a section heading. */
  headingCmds: Set<string>;
}

const LIST_ENV_DEFAULT = ["itemize", "enumerate", "description", "cvitems", "compactitem", "compactenum", "outline"];
const OPENS_LIST = /\\begin\s*\{(itemize|enumerate|description|cvitems)\}/;
const CLOSES_LIST = /\\end\s*\{(itemize|enumerate|description|cvitems)\}/;

/** Reads `\newcommand` / `\def` / `\newenvironment` definitions anywhere in the file. */
export function buildLexicon(src: string): Lexicon {
  const macros = new Map<string, MacroInfo>();
  const listEnvs = new Set(LIST_ENV_DEFAULT);

  const defRe = /\\(?:re)?newcommand\*?|\\providecommand\*?|\\DeclareRobustCommand\*?/g;
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(src)) !== null) {
    let j = skipFiller(src, m.index + m[0].length);
    let name = "";
    if (src[j] === "{") {
      const close = matchGroup(src, j);
      name = src.slice(j + 1, close - 1).trim().replace(/^\\/, "");
      j = close;
    } else if (src[j] === "\\") {
      let k = j + 1;
      while (isLetter(src[k]) || src[k] === "@") k++;
      name = src.slice(j + 1, k);
      j = k;
    }
    if (!/^[a-zA-Z@]+$/.test(name)) continue;
    let args = 0;
    let optional = false;
    j = skipFiller(src, j);
    if (src[j] === "[") {
      const close = matchGroup(src, j);
      args = parseInt(src.slice(j + 1, close - 1), 10) || 0;
      j = skipFiller(src, close);
      if (src[j] === "[") {
        optional = true;
        j = skipFiller(src, matchGroup(src, j));
      }
    }
    if (src[j] !== "{") continue;
    const bodyEnd = matchGroup(src, j);
    macros.set(name, { args, optional, body: src.slice(j + 1, bodyEnd - 1) });
    defRe.lastIndex = bodyEnd;
  }

  const plainDef = /\\def\s*\\([a-zA-Z@]+)((?:#\d)*)\s*\{/g;
  while ((m = plainDef.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchGroup(src, open);
    macros.set(m[1], { args: (m[2].match(/#/g) || []).length, optional: false, body: src.slice(open + 1, close - 1) });
  }

  const envRe = /\\newenvironment\s*\{([a-zA-Z*]+)\}/g;
  while ((m = envRe.exec(src)) !== null) {
    let j = skipFiller(src, m.index + m[0].length);
    while (src[j] === "[") j = skipFiller(src, matchGroup(src, j));
    if (src[j] !== "{") continue;
    const beginBody = src.slice(j + 1, matchGroup(src, j) - 1);
    if (OPENS_LIST.test(beginBody)) listEnvs.add(m[1]);
  }

  const listStart = new Set<string>();
  const listEnd = new Set<string>();
  const bulletMacros = new Set<string>();
  const headingCmds = new Set<string>();
  for (const [name, info] of macros) {
    const opens = OPENS_LIST.test(info.body);
    const closes = CLOSES_LIST.test(info.body);
    if (opens && !closes) listStart.add(name);
    if (closes && !opens) listEnd.add(name);
    if (info.args === 1 && /\\item\b/.test(info.body) && !opens) bulletMacros.add(name);
    if (/\\(?:sub)?section\*?\s*[{[]/.test(info.body) && info.args <= 1) headingCmds.add(name);
  }
  return { macros, listEnvs, listStart, listEnd, bulletMacros, headingCmds };
}

/* ---------- Structural events ---------- */

export type EventType = "open" | "close" | "list-open" | "list-close" | "env-open" | "env-close" | "item" | "cmd" | "linebreak";

export interface LatexEvent {
  type: EventType;
  start: number;
  /** Just past the command name (and, for \begin / \end, past the environment's arguments). */
  end: number;
  name: string;
  /** Brace depth relative to the scanned range. */
  depth: number;
}

/** Commands, groups, environments and list boundaries in a range, in order. */
export function scanEvents(src: string, start: number, end: number, lex: Lexicon): LatexEvent[] {
  const events: LatexEvent[] = [];
  let depth = 0;
  for (let i = start; i < end; i++) {
    const c = src[i];
    if (c === "%") {
      i = lineEnd(src, i);
    } else if (c === "{") {
      events.push({ type: "open", start: i, end: i + 1, name: "{", depth });
      depth++;
    } else if (c === "}") {
      depth--;
      events.push({ type: "close", start: i, end: i + 1, name: "}", depth });
    } else if (c === "\\") {
      const n = src[i + 1];
      if (n === "\\") {
        let j = i + 2;
        if (src[j] === "*") j++;
        const k = skipFiller(src, j, end);
        if (src[k] === "[") j = matchGroup(src, k, end);
        events.push({ type: "linebreak", start: i, end: j, name: "\\\\", depth });
        i = j - 1;
        continue;
      }
      if (!isLetter(n)) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < end && isLetter(src[j])) j++;
      const name = src.slice(i + 1, j);
      if (src[j] === "*") j++;
      if (name === "begin" || name === "end") {
        const k = skipFiller(src, j, end);
        if (src[k] === "{") {
          const close = matchGroup(src, k, end);
          const env = src.slice(k + 1, close - 1).trim();
          const isList = lex.listEnvs.has(env);
          let after = close;
          if (name === "begin") after = skipArgs(src, close, ENV_ARGS[env] ?? 0, end);
          if (name === "begin" && isList) {
            const o = skipFiller(src, after, end);
            if (src[o] === "[") after = matchGroup(src, o, end);
          }
          events.push({
            type: name === "begin" ? (isList ? "list-open" : "env-open") : isList ? "list-close" : "env-close",
            start: i,
            end: after,
            name: env,
            depth,
          });
          i = after - 1;
          continue;
        }
      }
      let type: EventType = "cmd";
      if (lex.listStart.has(name)) type = "list-open";
      else if (lex.listEnd.has(name)) type = "list-close";
      else if (name === "item") type = "item";
      events.push({ type, start: i, end: j, name, depth });
      i = j - 1;
    }
  }
  return events;
}

/**
 * The end of the group, environment or list that encloses `from`: the start
 * of the first closer that has no opener after `from`. Falls back to `end`.
 */
export function containerEnd(events: LatexEvent[], from: number, end: number): number {
  let braces = 0;
  let blocks = 0;
  for (const ev of events) {
    if (ev.start < from) continue;
    if (ev.type === "open") braces++;
    else if (ev.type === "close" && --braces < 0) return ev.start;
    else if (ev.type === "list-open" || ev.type === "env-open") blocks++;
    else if ((ev.type === "list-close" || ev.type === "env-close") && --blocks < 0) return ev.start;
  }
  return end;
}

/* ---------- Text runs ---------- */

interface Visitor {
  text(start: number, end: number): void;
  sep(text: string): void;
  url(start: number, end: number, shown: boolean): void;
}

/** Walks a range, reporting raw text, separators and link targets in order. */
function walkLatex(src: string, start: number, end: number, v: Visitor, exclude: Range[] = []): void {
  let i = start;
  while (i < end) {
    const skip = exclude.find((r) => r.start <= i && i < r.end);
    if (skip) {
      v.sep("\n");
      i = skip.end;
      continue;
    }
    const c = src[i];
    if (c === "%") {
      v.sep("");
      i = lineEnd(src, i);
      continue;
    }
    if (c === "\\") {
      const n = src[i + 1];
      if (n === undefined) break;
      if ("&%$#_{}".includes(n) || " ,;:!-@/".includes(n)) {
        v.text(i, i + 2);
        i += 2;
        continue;
      }
      if (n === "\\") {
        v.sep(" ");
        let j = i + 2;
        if (src[j] === "*") j++;
        const k = skipFiller(src, j, end);
        i = src[k] === "[" ? matchGroup(src, k, end) : j;
        continue;
      }
      if (ACCENT_MARKS[n] !== undefined) {
        let j = i + 2;
        if (src[j] === "{") j = matchGroup(src, j, end);
        else if (isLetter(src[j])) j++;
        v.text(i, j);
        i = j;
        continue;
      }
      if (!isLetter(n)) {
        v.sep("");
        i += 2;
        continue;
      }
      let j = i + 1;
      while (j < end && isLetter(src[j])) j++;
      const name = src.slice(i + 1, j);
      if (src[j] === "*") j++;
      i = command(name, j);
      continue;
    }
    if (c === "$") {
      const display = src[i + 1] === "$";
      const open = display ? 2 : 1;
      let j = i + open;
      while (j < end && !(src[j] === "$" && src[j - 1] !== "\\")) j++;
      v.sep(` ${mathText(src.slice(i + open, j))} `);
      i = Math.min(end, j + open);
      continue;
    }
    if (c === "{" || c === "}") {
      v.sep("");
      i++;
      continue;
    }
    if (c === "&") {
      v.sep(" ");
      i++;
      continue;
    }
    if (c === "\n") {
      let j = i + 1;
      while (j < end && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
      if (src[j] === "\n") {
        v.sep("\n\n");
        i = j + 1;
        continue;
      }
    }
    v.text(i, i + 1);
    i++;
  }

  function command(name: string, j: number): number {
    if (name === "href" || name === "url") {
      const k = skipFiller(src, j, end);
      if (src[k] !== "{") return j;
      const close = matchGroup(src, k, end);
      v.url(k + 1, close - 1, name === "url");
      v.sep("");
      return close;
    }
    if (name === "begin" || name === "end") {
      v.sep("\n");
      const k = skipFiller(src, j, end);
      if (src[k] !== "{") return j;
      const close = matchGroup(src, k, end);
      if (name === "end") return close;
      const env = src.slice(k + 1, close - 1).trim();
      let after = skipArgs(src, close, ENV_ARGS[env] ?? 0, end);
      const o = skipFiller(src, after, end);
      if (src[o] === "[") after = matchGroup(src, o, end);
      return after;
    }
    if (SKIP_ALL.has(name)) {
      v.sep("");
      let k = j;
      for (;;) {
        const f = skipFiller(src, k, end);
        if (src[f] === "{" || src[f] === "[") k = matchGroup(src, f, end);
        else if (src[f] === "\\" && k === j) {
          let e = f + 1;
          while (isLetter(src[e]) || src[e] === "@") e++;
          k = e;
        } else if (src[f] === "#") k = f + 2;
        else return k;
      }
    }
    if (SKIP_ARGS[name] !== undefined) {
      v.sep(" ");
      const k = skipArgs(src, j, SKIP_ARGS[name], end);
      if (name === "raisebox") {
        const f = skipFiller(src, k, end);
        if (src[f] === "[") return matchGroup(src, f, end);
      }
      return k;
    }
    if (DIMENSION_CMDS.has(name)) {
      v.sep(" ");
      const dim = DIMENSION.exec(src.slice(j, Math.min(end, j + 40)));
      return dim ? j + dim[0].length : j;
    }
    v.sep(TEXT_SYMBOLS[name] ?? "");
    if (name === "item") {
      const k = skipFiller(src, j, end);
      if (src[k] === "[") return matchGroup(src, k, end);
    }
    // TeX drops spaces after a control word.
    let k = j;
    while (k < end && (src[k] === " " || src[k] === "\t")) k++;
    return k;
  }
}

/** What a stretch of LaTeX reads as, on one line. */
export function plainText(src: string, start = 0, end = src.length, exclude: Range[] = []): string {
  let out = "";
  walkLatex(
    src,
    start,
    end,
    {
      text: (s, e) => (out += src.slice(s, e)),
      sep: (text) => (out += text),
      url: (s, e, shown) => {
        if (shown) out += src.slice(s, e);
      },
    },
    exclude
  );
  return decodeText(out.replace(/\s*\n\s*/g, " "));
}

/** A run of visible text an importer could turn into a placeholder. */
export interface Leaf extends Range {
  value: string;
  /** A link target (`\href{…}` / `\url{…}`) rather than visible text. */
  url: boolean;
}

// En dashes stay: "2019 – 2021" is a date range, not two values.
const RUN_SEPARATOR = /\s+(?:---|—)\s+|\s*(?:\||·|•)\s*/g;
const TRIM_CHARS = " \t\r\n~:;,|·•";

function trimRange(src: string, start: number, end: number): Range {
  let s = start;
  let e = end;
  for (;;) {
    while (s < e && TRIM_CHARS.includes(src[s])) s++;
    while (e > s && TRIM_CHARS.includes(src[e - 1]) && src[e - 2] !== "\\") e--;
    // Brackets only go when unmatched: "(Python)" → "Python", but "C++ (Advanced)" stays.
    const inner = src.slice(s, e);
    if ((src[s] === "(" || src[s] === "[") && !/[)\]]/.test(inner)) s++;
    else if ((src[e - 1] === ")" || src[e - 1] === "]") && !/[([]/.test(inner)) e--;
    else if (src[s] === "(" && src[e - 1] === ")" && !/[()]/.test(inner.slice(1, -1))) {
      s++;
      e--;
    } else break;
  }
  // A leading dash is a separator ("-- Present" is not a value); a trailing one too.
  while (s < e && src[s] === "-" && /\s/.test(src[s + 1] ?? "")) s = skipSpace(src, s + 1, e);
  return { start: s, end: e };
}

function skipSpace(src: string, i: number, end: number) {
  while (i < end && /\s/.test(src[i])) i++;
  return i;
}

/**
 * The text runs in a range. Runs break at commands, braces and math; inside a
 * run, " | ", " · " and similar separators split it further. With
 * `splitColon`, "Languages: Java, Go" becomes two runs ("Languages" and the list).
 */
export function collectLeaves(
  src: string,
  start: number,
  end: number,
  options: { exclude?: Range[]; splitColon?: boolean } = {}
): Leaf[] {
  const leaves: Leaf[] = [];
  let runStart = -1;
  let runEnd = -1;

  const push = (s: number, e: number) => {
    const r = trimRange(src, s, e);
    const value = decodeText(src.slice(r.start, r.end));
    if (/[\p{L}\p{N}]/u.test(value)) leaves.push({ ...r, value, url: false });
  };

  const flush = () => {
    if (runStart < 0) return;
    const raw = src.slice(runStart, runEnd);
    const parts: Range[] = [];
    let last = 0;
    RUN_SEPARATOR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RUN_SEPARATOR.exec(raw)) !== null) {
      if (m[0].length === 0) {
        RUN_SEPARATOR.lastIndex++;
        continue;
      }
      parts.push({ start: runStart + last, end: runStart + m.index });
      last = m.index + m[0].length;
    }
    parts.push({ start: runStart + last, end: runEnd });

    for (const part of parts) {
      const text = src.slice(part.start, part.end);
      const colon = options.splitColon ? /^([^:]{1,40}?):\s+(?=\S)/.exec(text.replace(/^\s+/, "")) : null;
      if (colon && colon[1].trim().split(/\s+/).length <= 4) {
        const lead = text.length - text.replace(/^\s+/, "").length;
        const split = part.start + lead + colon[1].length;
        push(part.start, split);
        push(split + 1, part.end);
      } else {
        push(part.start, part.end);
      }
    }
    runStart = -1;
  };

  walkLatex(
    src,
    start,
    end,
    {
      text: (s, e) => {
        if (runStart >= 0 && s === runEnd) runEnd = e;
        else {
          flush();
          runStart = s;
          runEnd = e;
        }
      },
      sep: () => flush(),
      url: (s, e) => {
        flush();
        const r = trimRange(src, s, e);
        const value = src.slice(r.start, r.end).replace(/\\([%#&_])/g, "$1").trim();
        if (value) leaves.push({ ...r, value, url: true });
      },
    },
    options.exclude
  );
  flush();
  return leaves.sort((a, b) => a.start - b.start);
}

/** The range with leading and trailing whitespace removed. */
export function trimWhitespace(src: string, range: Range): Range {
  let { start, end } = range;
  while (start < end && /\s/.test(src[start])) start++;
  while (end > start && /\s/.test(src[end - 1])) end--;
  return { start, end };
}
