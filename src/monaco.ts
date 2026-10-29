import { loader } from "@monaco-editor/react";
// Editor core + features only; see monacoFeatures.ts for why languages are excluded.
import "./monacoFeatures";
import * as monaco from "monaco-editor/editor/editor.api";
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
          // Match the command name ($1) against the keyword list, not "\\name"
          cases: {
            "$1@keywords": "keyword",
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

// Editor colours follow the app's palette (see the tokens in styles.css).
monaco.editor.defineTheme("vitae-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6B7680", fontStyle: "italic" },
    { token: "keyword", foreground: "2C5A4B", fontStyle: "bold" },
    { token: "tag", foreground: "1F5C8F" },
    { token: "string.math", foreground: "8A4B0F" },
    { token: "string.escape", foreground: "8A4B0F" },
    { token: "delimiter", foreground: "5B6670" },
  ],
  colors: {
    "editor.background": "#FFFFFF",
    "editor.foreground": "#1D2731",
    "editorLineNumber.foreground": "#9AA3AA",
    "editorLineNumber.activeForeground": "#1D2731",
    "editor.lineHighlightBackground": "#F3F5F4",
    "editor.selectionBackground": "#CFE3DA",
    "editorCursor.foreground": "#2C5A4B",
    "editorRuler.foreground": "#E6EAE8",
    "editorIndentGuide.background1": "#ECEFED",
    // Calm, single-colour brackets instead of Monaco's rainbow defaults
    "editorBracketHighlight.foreground1": "#5B6670",
    "editorBracketHighlight.foreground2": "#5B6670",
    "editorBracketHighlight.foreground3": "#5B6670",
    "editorBracketMatch.background": "#E4EFEA",
    "editorBracketMatch.border": "#2C5A4B",
  },
});

monaco.editor.defineTheme("vitae-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8C9892", fontStyle: "italic" },
    { token: "keyword", foreground: "7CC4A6", fontStyle: "bold" },
    { token: "tag", foreground: "8EC1EA" },
    { token: "string.math", foreground: "E3B37C" },
    { token: "string.escape", foreground: "E3B37C" },
    { token: "delimiter", foreground: "A9B4AE" },
  ],
  colors: {
    "editor.background": "#1A2024",
    "editor.foreground": "#E4E9E6",
    "editorLineNumber.foreground": "#5E6A70",
    "editorLineNumber.activeForeground": "#E4E9E6",
    "editor.lineHighlightBackground": "#20272B",
    "editor.selectionBackground": "#2E4A40",
    "editorCursor.foreground": "#7CC4A6",
    "editorRuler.foreground": "#2A3237",
    "editorIndentGuide.background1": "#262E33",
    "editorBracketHighlight.foreground1": "#A9B4AE",
    "editorBracketHighlight.foreground2": "#A9B4AE",
    "editorBracketHighlight.foreground3": "#A9B4AE",
    "editorBracketMatch.background": "#1F342D",
    "editorBracketMatch.border": "#78C2A4",
  },
});

// Point @monaco-editor/react directly to our local monaco bundle (offline-first, no CDN)
loader.config({ monaco });

export { monaco };
