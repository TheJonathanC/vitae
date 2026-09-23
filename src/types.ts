export interface Document {
  id: string;
  title: string;
  content: string;
  template_id?: string | null;
  resume_data?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  content: string;
  is_builtin: boolean;
  created_at: string;
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
  download_url?: string | null;
}

export interface ResumePersonalInfo {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
  summary?: string;
}

export interface ResumeExperienceItem {
  id: string;
  role: string;
  company: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  bullets: string[];
}

export interface ResumeEducationItem {
  id: string;
  degree: string;
  institution: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  details?: string;
}

export interface ResumeProjectItem {
  id: string;
  name: string;
  technologies?: string;
  link?: string;
  bullets: string[];
}

export interface ResumeSkillItem {
  id: string;
  category: string;
  skills: string;
}

export interface ResumeCustomSection {
  id: string;
  title: string;
  content?: string;
  bullets?: string[];
}

export interface ResumeData {
  personal: ResumePersonalInfo;
  experience: ResumeExperienceItem[];
  education: ResumeEducationItem[];
  projects: ResumeProjectItem[];
  skills: ResumeSkillItem[];
  customSections?: ResumeCustomSection[];
  customVariables?: Record<string, string>;
}

export interface ExtractedTemplateField {
  key: string;
  label: string;
  type: "text" | "textarea";
  section?: string;
}

export interface ExtractedTemplateAnalysis {
  hasStandardStructure: boolean;
  detectedSections: string[];
  customVariables: ExtractedTemplateField[];
}
