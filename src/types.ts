export interface Document {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface LatexError {
  line: number | null;
  message: string;
  severity: "error" | "warning" | string;
}

export interface CompilationResult {
  success: boolean;
  pdf_path?: string;
  errors: LatexError[];
}

export interface UpdateCheckResponse {
  should_update: boolean;
  version: string | null;
  date: string | null;
  body: string | null;
}
