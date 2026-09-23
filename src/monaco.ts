import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";

// Set up Monaco environment to use local Web Worker
if (typeof window !== "undefined") {
  (window as any).MonacoEnvironment = {
    getWorker(_: any, _label: string) {
      return new editorWorker();
    },
  };
}

// Define LaTeX syntax highlighting rules using Monarch
export const latexMonarchTokens: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".latex",

  keywords: [
    "documentclass",
    "usepackage",
    "begin",
    "end",
    "newcommand",
    "renewcommand",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
    "title",
    "author",
    "date",
    "maketitle",
    "tableofcontents",
    "label",
    "ref",
    "pageref",
    "cite",
    "bibliography",
    "bibliographystyle",
    "input",
    "include",
    "includeonly",
    "caption",
    "footnote",
    "item",
    "centering",
    "textbf",
    "textit",
    "emph",
    "underline",
    "href",
    "url",
  ],

  tokenizer: {
    root: [
      // Comments
      [/(%.*$)/, "comment"],

      // Display math $$ ... $$ or \[ ... \]
      [/\$\$/, { token: "string.math", next: "@mathDisplay" }],
      [/\\\[/, { token: "string.math", next: "@mathDisplayBracket" }],

      // Inline math $ ... $ or \( ... \)
      [/\$/, { token: "string.math", next: "@mathInline" }],
      [/\\\(/, { token: "string.math", next: "@mathInlineParen" }],

      // LaTeX commands: e.g. \documentclass, \textbf, \alpha
      [
        /\\([a-zA-Z@]+)/,
        {
          cases: {
            "@keywords": "keyword",
            "@default": "tag",
          },
        },
      ],

      // Escaped characters (e.g. \%, \$, \&, \\)
      [/\\./, "string.escape"],

      // Delimiters
      [/[{}]/, "delimiter.curly"],
      [/[\[\]]/, "delimiter.square"],
      [/[()]/, "delimiter.parenthesis"],
      [/[&_^~]/, "delimiter"],
    ],

    mathDisplay: [
      [/\$\$/, { token: "string.math", next: "@pop" }],
      [/\\([a-zA-Z@]+)/, "tag"],
      [/\\./, "string.escape"],
      [/[^\\$]+/, "string.math"],
      [/./, "string.math"],
    ],

    mathDisplayBracket: [
      [/\\\]/, { token: "string.math", next: "@pop" }],
      [/\\([a-zA-Z@]+)/, "tag"],
      [/\\./, "string.escape"],
      [/[^\\]+/, "string.math"],
      [/./, "string.math"],
    ],

    mathInline: [
      [/\$/, { token: "string.math", next: "@pop" }],
      [/\\([a-zA-Z@]+)/, "tag"],
      [/\\./, "string.escape"],
      [/[^\\$]+/, "string.math"],
      [/./, "string.math"],
    ],

    mathInlineParen: [
      [/\\\)/, { token: "string.math", next: "@pop" }],
      [/\\([a-zA-Z@]+)/, "tag"],
      [/\\./, "string.escape"],
      [/[^\\]+/, "string.math"],
      [/./, "string.math"],
    ],
  },
};

export const latexLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: "%",
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
    { open: '"', close: '"' },
  ],
};

// Register LaTeX language if not already registered
if (!monaco.languages.getLanguages().some((lang) => lang.id === "latex")) {
  monaco.languages.register({
    id: "latex",
    extensions: [".tex", ".sty", ".cls", ".bib"],
    aliases: ["LaTeX", "latex", "tex"],
    mimetypes: ["text/x-latex", "text/x-tex"],
  });
  monaco.languages.setMonarchTokensProvider("latex", latexMonarchTokens);
  monaco.languages.setLanguageConfiguration("latex", latexLanguageConfiguration);
}

// Point @monaco-editor/react directly to our local monaco bundle (offline-first, no CDN)
loader.config({ monaco });

export { monaco };
