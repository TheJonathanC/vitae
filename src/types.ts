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
  /** Template-specific fields this entry fills, beyond the standard ones. */
  fields?: Record<string, string>;
}

export interface ResumeEducationItem {
  id: string;
  degree: string;
  institution: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  details?: string;
  /** Template-specific fields this entry fills, beyond the standard ones. */
  fields?: Record<string, string>;
}

export interface ResumeProjectItem {
  id: string;
  name: string;
  technologies?: string;
  link?: string;
  bullets: string[];
  /** Template-specific fields this entry fills, beyond the standard ones. */
  fields?: Record<string, string>;
}

export interface ResumeSkillItem {
  id: string;
  category: string;
  skills: string;
  /** Template-specific fields this entry fills, beyond the standard ones. */
  fields?: Record<string, string>;
}

export interface ResumeCustomSection {
  id: string;
  title: string;
  content?: string;
  bullets?: string[];
  /** Template-specific fields this entry fills, beyond the standard ones. */
  fields?: Record<string, string>;
}

/** An entry of a section the template defines itself (e.g. Publications). */
export interface ResumeListItem {
  id: string;
  fields: Record<string, string>;
  bullets: string[];
}

export interface ResumeData {
  personal: ResumePersonalInfo;
  experience: ResumeExperienceItem[];
  education: ResumeEducationItem[];
  projects: ResumeProjectItem[];
  skills: ResumeSkillItem[];
  customSections?: ResumeCustomSection[];
  customVariables?: Record<string, string>;
  /** Entries of template-defined sections, keyed by the section's placeholder name. */
  customLists?: Record<string, ResumeListItem[]>;
  sectionOrder?: string[];
  /**
   * Set when the LaTeX source was edited by hand. The form then stops
   * re-rendering the document so those edits aren't silently overwritten.
   */
  sourceEditedManually?: boolean;
}

export interface ExtractedTemplateField {
  key: string;
  label: string;
  type: "text" | "textarea";
  section?: string;
}

export type BuiltinListKey = "experience" | "education" | "projects" | "skills" | "customSections";

/** A repeating section a template renders, and what each of its entries uses. */
export interface TemplateSectionSchema {
  /** Data key: a built-in list or a key of `customLists`. */
  key: string;
  builtin: boolean;
  /** Heading the template prints for the section, when it is fixed text. */
  heading?: string;
  /** Entry-level placeholders, in the order they first appear. */
  fields: string[];
  hasBullets: boolean;
}

export interface ExtractedTemplateAnalysis {
  /** True when the template renders at least one repeating section. */
  hasStandardStructure: boolean;
  /** Built-in sections the template renders, in template order. */
  detectedSections: string[];
  /** Top-level placeholders that aren't standard contact details. */
  customVariables: ExtractedTemplateField[];
  /** Standard contact fields (name, email, ...) the template uses. */
  personalFields: string[];
  /** Every repeating section, built-in or template-defined, in template order. */
  sections: TemplateSectionSchema[];
}

export interface TexInstallCommand {
  manager: string;
  command: string;
}

export interface TexStatus {
  installed: boolean;
  kind: "miktex" | "texlive" | null;
  platform: "windows" | "macos" | "linux";
  linux_command: TexInstallCommand | null;
}

export interface TexInstallProgress {
  phase: string;
  message: string;
}

export interface TexPackage {
  name: string;
  size_bytes: number;
  core: boolean;
}

export interface TexOverview {
  kind: "miktex" | "texlive";
  total_bytes: number;
  packages: TexPackage[];
}

export type LibraryKind = "experience" | "project" | "education" | "skill";

/** A row from the backend; `data` is the item's JSON without its id. */
export interface LibraryRow {
  id: string;
  kind: LibraryKind;
  data: string;
  created_at: string;
  updated_at: string;
}

/** The reusable entries a user has saved, each carrying its library id. */
export interface Library {
  experience: ResumeExperienceItem[];
  project: ResumeProjectItem[];
  education: ResumeEducationItem[];
  skill: ResumeSkillItem[];
}

/** Which library entries a profile includes, plus its own headline and summary. */
export interface ProfileSpec {
  headline: string;
  summary: string;
  experienceIds: string[];
  projectIds: string[];
  educationIds: string[];
  skillIds: string[];
}

export interface ProfileRow {
  id: string;
  name: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface Profile extends ProfileSpec {
  id: string;
  name: string;
}

export interface AiSettingsView {
  has_key: boolean;
  provider: "anthropic" | "openai" | "gemini" | null;
  provider_name: string | null;
  model: string | null;
}

export interface AiModel {
  id: string;
  created: number;
  recommended: boolean;
}

export interface AiModels {
  provider: "anthropic" | "openai" | "gemini";
  provider_name: string;
  models: AiModel[];
}

export interface RewriteItem {
  id: string;
  text: string;
}
