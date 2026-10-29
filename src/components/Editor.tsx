import { useEffect, useRef, useState } from "react";

const darkQuery = () =>
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** Follows the OS light/dark setting, like the rest of the app. */
function useEditorTheme() {
  const [dark, setDark] = useState(() => darkQuery()?.matches ?? false);
  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const update = () => setDark(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return dark ? "vitae-dark" : "vitae-light";
}
import MonacoEditor, { Monaco, OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { LatexError } from "../types";
// Registers the LaTeX language and points the loader at the local Monaco build.
// Imported here (not in main.tsx) so Monaco is only loaded with this lazy chunk.
import "../monaco";

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  errors?: LatexError[];
}

function Editor({ content, onChange, errors = [] }: EditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const theme = useEditorTheme();

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const model = editorRef.current.getModel();
    if (!model) return;

    // Convert errors to Monaco markers
    const markers = errors
      .filter((err) => err.line !== null && err.line > 0)
      .map((err) => {
        const lineNumber = err.line!;
        const lineContent = model.getLineContent(lineNumber);
        const maxColumn = lineContent.length + 1;
        
        return {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: maxColumn,
          message: err.message,
          severity:
            err.severity === "error"
              ? monacoRef.current.MarkerSeverity.Error
              : monacoRef.current.MarkerSeverity.Warning,
        };
      });

    monacoRef.current.editor.setModelMarkers(model, "latex", markers);
  }, [errors]);

  return (
    <div className="monaco-wrapper">
      <MonacoEditor
        height="100%"
        defaultLanguage="latex"
        value={content}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        theme={theme}
        loading={<div className="pane-loading">Loading the LaTeX editor…</div>}
        options={{
          minimap: { enabled: false },
          bracketPairColorization: { enabled: false },
          fontSize: 13.5,
          fontFamily: "'Cascadia Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
          lineHeight: 21,
          padding: { top: 16 },
          lineNumbers: "on",
          rulers: [80],
          wordWrap: "on",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          tabSize: 2,
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
        }}
      />
    </div>
  );
}

export default Editor;
