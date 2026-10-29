import { Template } from "../types";
// Shared with the Rust backend (src-tauri/src/db.rs) so the two can't drift.
import modernTemplate from "../../src-tauri/templates/modern.tex?raw";
import classicTemplate from "../../src-tauri/templates/classic.tex?raw";
import minimalTemplate from "../../src-tauri/templates/minimal.tex?raw";

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "template-modern",
    name: "Modern Professional",
    description:
      "Clean sans-serif / small-caps resume with horizontal dividers and structured sections for tech and industry professionals.",
    is_builtin: true,
    created_at: new Date().toISOString(),
    content: modernTemplate,
  },
  {
    id: "template-classic",
    name: "Classic Academic",
    description:
      "Traditional serif layout with formal styling, ideal for academic CVs, research positions, and executive resumes.",
    is_builtin: true,
    created_at: new Date().toISOString(),
    content: classicTemplate,
  },
  {
    id: "template-minimal",
    name: "Minimalist Single-Column",
    description:
      "Sleek and compact single-column format optimized for readability and automated ATS parsers.",
    is_builtin: true,
    created_at: new Date().toISOString(),
    content: minimalTemplate,
  },
];
