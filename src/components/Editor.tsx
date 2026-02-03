import MonacoEditor from "@monaco-editor/react";

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
}

function Editor({ content, onChange }: EditorProps) {
  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  return (
    <div className="monaco-wrapper">
      <MonacoEditor
        height="100%"
        defaultLanguage="latex"
        value={content}
        onChange={handleEditorChange}
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
        }}
      />
    </div>
  );
}

export default Editor;
