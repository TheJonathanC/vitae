import { Template } from "../types";

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "template-modern",
    name: "Modern Professional",
    description:
      "Clean sans-serif / small-caps resume with horizontal dividers and structured sections for tech and industry professionals.",
    is_builtin: true,
    created_at: new Date().toISOString(),
    content: `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage{enumitem}

\\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue}
\\urlstyle{same}

\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-0.5in}
\\addtolength{\\textheight}{1.0in}

\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

\\begin{document}

\\begin{center}
    {\\Huge \\scshape {{name}}} \\\\ \\vspace{2pt}
    {{#title}}{\\large \\textit{{{title}}}} \\\\ \\vspace{2pt}{{/title}}
    \\small {{phone}} {{#email}}$|$ \\href{mailto:{{email}}}{{{email}}}{{/email}} {{#website}}$|$ \\href{{{website}}}{{{website}}}{{/website}} {{#linkedin}}$|$ \\href{https://{{linkedin}}}{{{linkedin}}}{{/linkedin}} {{#github}}$|$ \\href{https://{{github}}}{{{github}}}{{/github}} {{#location}}$|$ {{location}}{{/location}}
\\end{center}

{{#summary}}
\\section{Summary}
{{summary}}
{{/summary}}

{{#experience}}
\\section{Experience}
{{#items}}
\\textbf{{{role}}} \\hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\\\
\\textit{{{company}}}{{#location}} \\hfill {{location}}{{/location}}
{{#highlights}}
\\begin{itemize}[noitemsep,topsep=1pt]
{{#bullets}}
    \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
\\vspace{4pt}
{{/items}}
{{/experience}}

{{#education}}
\\section{Education}
{{#items}}
\\textbf{{{institution}}} \\hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\\\
\\textit{{{degree}}}{{#location}} \\hfill {{location}}{{/location}}
{{#details}}\\\\\\small {{details}}{{/details}}
\\vspace{4pt}
{{/items}}
{{/education}}

{{#projects}}
\\section{Projects}
{{#items}}
\\textbf{{{name}}}{{#technologies}} $|$ \\textit{{{technologies}}}{{/technologies}}{{#link}} \\hfill \\href{{{link}}}{Link}{{/link}}
{{#highlights}}
\\begin{itemize}[noitemsep,topsep=1pt]
{{#bullets}}
    \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
\\vspace{4pt}
{{/items}}
{{/projects}}

{{#skills}}
\\section{Technical Skills}
{{#items}}
\\textbf{{{category}}}: {{skills}} \\\\
{{/items}}
{{/skills}}

{{#customSections}}
\\section{{{title}}}
{{#content}}{{content}} \\\\{{/content}}
{{#highlights}}
\\begin{itemize}[noitemsep,topsep=1pt]
{{#bullets}}
    \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
{{/customSections}}

\\end{document}`,
  },
  {
    id: "template-classic",
    name: "Classic Academic",
    description:
      "Traditional serif layout with formal styling, ideal for academic CVs, research positions, and executive resumes.",
    is_builtin: true,
    created_at: new Date().toISOString(),
    content: `\\documentclass[10pt,letterpaper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage{enumitem}

\\hypersetup{colorlinks=false,pdfborder={0 0 0}}

\\titleformat{\\section}{\\large\\bfseries\\scshape}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{10pt}{5pt}

\\begin{document}
\\pagestyle{empty}

\\begin{center}
    {\\huge \\textbf{{{name}}}} \\\\ \\vspace{4pt}
    {{#title}}{\\large \\textit{{{title}}}} \\\\ \\vspace{2pt}{{/title}}
    \\small {{#location}}{{location}} \\ $\\cdot$ \\ {{/location}}{{phone}}{{#email}} \\ $\\cdot$ \\ {{email}}{{/email}}{{#website}} \\ $\\cdot$ \\ {{website}}{{/website}}{{#linkedin}} \\ $\\cdot$ \\ {{linkedin}}{{/linkedin}}
\\end{center}

{{#summary}}
\\section{Professional Summary}
{{summary}}
{{/summary}}

{{#education}}
\\section{Education}
{{#items}}
\\textbf{{{institution}}}{{#location}}, {{location}}{{/location}} \\hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\\\
\\textit{{{degree}}}
{{#details}}\\\\\\small {{details}}{{/details}}
\\vspace{4pt}
{{/items}}
{{/education}}

{{#experience}}
\\section{Professional Experience}
{{#items}}
\\textbf{{{role}}}, {{company}}{{#location}} --- {{location}}{{/location}} \\hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\\\
{{#highlights}}
\\begin{itemize}[leftmargin=1.5em,noitemsep,topsep=2pt]
{{#bullets}}
    \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
\\vspace{4pt}
{{/items}}
{{/experience}}

{{#projects}}
\\section{Key Projects}
{{#items}}
\\textbf{{{name}}}{{#technologies}} (\\textit{{{technologies}}}){{/technologies}}{{#link}} \\hfill {{link}}{{/link}}
{{#highlights}}
\\begin{itemize}[leftmargin=1.5em,noitemsep,topsep=2pt]
{{#bullets}}
    \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
\\vspace{4pt}
{{/items}}
{{/projects}}

{{#skills}}
\\section{Skills \\& Competencies}
{{#items}}
\\textbf{{{category}}}: {{skills}} \\\\
{{/items}}
{{/skills}}

{{#customSections}}
\\section{{{title}}}
{{#content}}{{content}} \\\\{{/content}}
{{#highlights}}
\\begin{itemize}[leftmargin=1.5em,noitemsep,topsep=2pt]
{{#bullets}}
    \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
{{/customSections}}

\\end{document}`,
  },
  {
    id: "template-minimal",
    name: "Minimalist Single-Column",
    description:
      "Sleek and compact single-column format optimized for readability and automated ATS parsers.",
    is_builtin: true,
    created_at: new Date().toISOString(),
    content: `\\documentclass[10pt,letterpaper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=0.6in]{geometry}
\\usepackage{hyperref}
\\usepackage{enumitem}

\\hypersetup{colorlinks=true,linkcolor=black,urlcolor=blue}
\\urlstyle{same}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{4pt}

\\newcommand{\\resumesection}[1]{%
  \\vspace{6pt}%
  {\\large\\textbf{\\uppercase{#1}}}%
  \\vspace{2pt}\\hrule\\vspace{4pt}%
}

\\begin{document}
\\pagestyle{empty}

{\\LARGE \\textbf{{{name}}}} \\\\
{{#title}}{\\textbf{{{title}}}} \\\\{{/title}}
\\small {{#email}}{{email}} \\ $\\vert$ \\ {{/email}}{{phone}}{{#location}} \\ $\\vert$ \\ {{location}}{{/location}}{{#github}} \\ $\\vert$ \\ \\href{https://{{github}}}{{{github}}}{{/github}}{{#linkedin}} \\ $\\vert$ \\ \\href{https://{{linkedin}}}{{{linkedin}}}{{/linkedin}}{{#website}} \\ $\\vert$ \\ \\href{{{website}}}{{{website}}}{{/website}}

{{#summary}}
\\resumesection{About}
{{summary}}
{{/summary}}

{{#experience}}
\\resumesection{Experience}
{{#items}}
\\textbf{{{role}}} \\hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\\\
\\textit{{{company}}}{{#location}} \\hfill {{location}}{{/location}}
{{#highlights}}
\\begin{itemize}[leftmargin=1.2em,noitemsep,topsep=1pt]
{{#bullets}}
  \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
\\vspace{2pt}
{{/items}}
{{/experience}}

{{#education}}
\\resumesection{Education}
{{#items}}
\\textbf{{{degree}}} \\hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\\\
\\textit{{{institution}}}{{#location}} \\hfill {{location}}{{/location}}
{{#details}}\\\\\\small {{details}}{{/details}}
\\vspace{2pt}
{{/items}}
{{/education}}

{{#projects}}
\\resumesection{Projects}
{{#items}}
\\textbf{{{name}}}{{#technologies}} --- \\textit{{{technologies}}}{{/technologies}}{{#link}} \\hfill \\href{{{link}}}{{{link}}}{{/link}}
{{#highlights}}
\\begin{itemize}[leftmargin=1.2em,noitemsep,topsep=1pt]
{{#bullets}}
  \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
\\vspace{2pt}
{{/items}}
{{/projects}}

{{#skills}}
\\resumesection{Skills}
{{#items}}
\\textbf{{{category}}}: {{skills}} \\\\
{{/items}}
{{/skills}}

{{#customSections}}
\\resumesection{{{title}}}
{{#content}}{{content}} \\\\{{/content}}
{{#highlights}}
\\begin{itemize}[leftmargin=1.2em,noitemsep,topsep=1pt]
{{#bullets}}
  \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
{{/customSections}}

\\end{document}`,
  },
];
