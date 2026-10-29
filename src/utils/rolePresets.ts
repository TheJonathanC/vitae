/**
 * Common roles with the terms a resume for them usually needs. `core` terms weigh
 * more than `related` ones. Used on their own or alongside a pasted job description.
 */
export interface RolePreset {
  id: string;
  name: string;
  headline: string;
  core: string[];
  related: string[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: "backend",
    name: "Backend engineer",
    headline: "Backend Engineer",
    core: ["api design", "rest api", "microservices", "sql", "postgresql", "distributed systems", "docker", "ci/cd", "unit testing", "system design"],
    related: ["python", "java", "golang", "node.js", "redis", "kafka", "aws", "kubernetes", "graphql", "grpc", "caching", "scalability", "observability", "message queues", "performance"],
  },
  {
    id: "frontend",
    name: "Frontend engineer",
    headline: "Frontend Engineer",
    core: ["javascript", "typescript", "react", "html", "css", "responsive design", "accessibility", "unit testing", "performance"],
    related: ["redux", "next.js", "vue", "angular", "webpack", "vite", "tailwind", "graphql", "rest api", "figma", "cross-browser", "web vitals", "storybook"],
  },
  {
    id: "fullstack",
    name: "Full-stack engineer",
    headline: "Full-Stack Engineer",
    core: ["javascript", "typescript", "react", "node.js", "rest api", "sql", "api design", "ci/cd", "docker"],
    related: ["postgresql", "mongodb", "graphql", "aws", "html", "css", "unit testing", "agile", "redis", "next.js"],
  },
  {
    id: "mobile",
    name: "Mobile developer",
    headline: "Mobile Developer",
    core: ["ios", "android", "swift", "kotlin", "mobile app", "rest api", "unit testing", "app store"],
    related: ["react native", "flutter", "swiftui", "jetpack compose", "firebase", "push notifications", "ci/cd", "accessibility", "performance"],
  },
  {
    id: "devops",
    name: "DevOps / SRE / cloud engineer",
    headline: "DevOps Engineer",
    core: ["aws", "kubernetes", "docker", "terraform", "ci/cd", "linux", "monitoring", "infrastructure as code", "automation"],
    related: ["azure", "gcp", "ansible", "jenkins", "github actions", "prometheus", "grafana", "helm", "bash", "python", "incident response", "reliability", "security", "observability", "on-call"],
  },
  {
    id: "data-analyst",
    name: "Data analyst",
    headline: "Data Analyst",
    core: ["sql", "excel", "tableau", "power bi", "data visualization", "dashboards", "statistics", "reporting", "data analysis"],
    related: ["python", "pandas", "looker", "etl", "a/b testing", "stakeholder management", "kpis", "data cleaning", "forecasting", "bigquery", "snowflake"],
  },
  {
    id: "data-scientist",
    name: "Data scientist / ML engineer",
    headline: "Data Scientist",
    core: ["python", "machine learning", "statistics", "sql", "pandas", "scikit-learn", "model deployment", "feature engineering", "a/b testing"],
    related: ["tensorflow", "pytorch", "deep learning", "nlp", "llm", "spark", "airflow", "mlops", "experimentation", "data pipeline", "docker", "aws"],
  },
  {
    id: "qa",
    name: "QA / test engineer",
    headline: "QA Engineer",
    core: ["test automation", "unit testing", "integration testing", "test plans", "selenium", "ci/cd", "bug tracking", "regression testing"],
    related: ["cypress", "playwright", "jest", "api testing", "postman", "jira", "agile", "performance testing", "python", "sql"],
  },
  {
    id: "product-manager",
    name: "Product manager",
    headline: "Product Manager",
    core: ["roadmap", "product strategy", "stakeholder management", "user research", "cross-functional", "prioritization", "agile", "metrics", "go-to-market"],
    related: ["a/b testing", "jira", "sql", "okrs", "kpis", "user stories", "customer interviews", "pricing", "analytics", "scrum", "launch"],
  },
  {
    id: "designer",
    name: "UX / product designer",
    headline: "Product Designer",
    core: ["figma", "user research", "wireframing", "prototyping", "design systems", "usability testing", "interaction design", "accessibility"],
    related: ["user flows", "information architecture", "a/b testing", "sketch", "adobe xd", "visual design", "stakeholder management", "design thinking", "cross-functional"],
  },
  {
    id: "project-manager",
    name: "Project / program manager",
    headline: "Project Manager",
    core: ["project management", "stakeholder management", "budgeting", "risk management", "scheduling", "agile", "scrum", "cross-functional"],
    related: ["pmp", "jira", "kanban", "resource planning", "reporting", "vendor management", "roadmap", "waterfall", "change management", "kpis"],
  },
  {
    id: "marketing",
    name: "Marketing",
    headline: "Marketing Manager",
    core: ["content marketing", "seo", "campaigns", "analytics", "email marketing", "social media", "brand", "lead generation"],
    related: ["google analytics", "hubspot", "crm", "a/b testing", "paid ads", "copywriting", "conversion rate", "kpis", "budgeting", "market research"],
  },
  {
    id: "sales",
    name: "Sales / account executive",
    headline: "Account Executive",
    core: ["quota", "pipeline", "crm", "salesforce", "prospecting", "negotiation", "closing", "revenue growth"],
    related: ["cold outreach", "forecasting", "account management", "customer success", "hubspot", "demos", "upselling", "stakeholder management", "b2b", "saas"],
  },
  {
    id: "customer-success",
    name: "Customer support / success",
    headline: "Customer Success Manager",
    core: ["customer success", "onboarding", "retention", "support tickets", "crm", "customer satisfaction", "escalation", "communication"],
    related: ["zendesk", "salesforce", "churn", "upselling", "nps", "csat", "documentation", "training", "stakeholder management"],
  },
  {
    id: "finance",
    name: "Finance / accounting",
    headline: "Financial Analyst",
    core: ["financial modeling", "forecasting", "budgeting", "excel", "financial reporting", "variance analysis", "gaap", "audit"],
    related: ["sql", "accounts payable", "reconciliation", "kpis", "sap", "quickbooks", "tax", "cash flow", "stakeholder management", "compliance"],
  },
];

export const findRolePreset = (id: string): RolePreset | undefined => ROLE_PRESETS.find((p) => p.id === id);
