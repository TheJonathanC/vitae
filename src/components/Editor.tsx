import { useEffect, useRef } from "react";
import MonacoEditor, { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface LatexError {
  line: number | null;
  message: string;
  severity: string;
}

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  errors?: LatexError[];
}

function Editor({ content, onChange, errors = [] }: EditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);

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
        theme="vs-dark"
        options={{
          minimap: { enabled: true },
          fontSize: 14,
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
