import fs from "node:fs";
import path from "node:path";

const DOC_SLUG_PATTERN = /^[a-z0-9-]+$/i;

export interface DocMeta {
  slug: string;
  title: string;
  order: number;
  section: "Start Here" | "Core Concepts" | "Integration" | "Advanced" | "Reference";
  summary: string;
  agentPriority: number;
  tags: string[];
}

const DOC_META: Record<string, Omit<DocMeta, "slug">> = {
  "getting-started": {
    title: "Getting Started",
    order: 10,
    section: "Start Here",
    summary: "Fastest path to boot the stack and run a first end-to-end workflow.",
    agentPriority: 1,
    tags: ["setup", "onboarding", "workflow", "quickstart"]
  },
  "local-dev": {
    title: "Local Development",
    order: 20,
    section: "Start Here",
    summary: "Day-to-day run, make targets, ports, and local troubleshooting.",
    agentPriority: 2,
    tags: ["setup", "runtime", "docker", "troubleshooting"]
  },
  "agent-playbook": {
    title: "Agent Playbook",
    order: 25,
    section: "Start Here",
    summary: "Purpose-built reading path and workflow for AI coding agents.",
    agentPriority: 0,
    tags: ["agent", "workflow", "contracts", "runtime"]
  },
  concepts: {
    title: "Concepts",
    order: 30,
    section: "Core Concepts",
    summary: "Mental model for runs, sessions, reviews, releases, and signals.",
    agentPriority: 3,
    tags: ["concepts", "model", "review", "release", "memory"]
  },
  architecture: {
    title: "Architecture",
    order: 40,
    section: "Core Concepts",
    summary: "System boundaries, runtime components, and data model shape.",
    agentPriority: 4,
    tags: ["architecture", "runtime", "components", "data-model"]
  },
  api: {
    title: "API",
    order: 50,
    section: "Integration",
    summary: "REST and daemon contract surface for tooling and integrations.",
    agentPriority: 5,
    tags: ["api", "contracts", "integration", "agent"]
  },
  "github-setup": {
    title: "GitHub Setup",
    order: 60,
    section: "Integration",
    summary: "GitHub App permissions and callback setup details.",
    agentPriority: 7,
    tags: ["github", "integration", "auth", "publish"]
  },
  "advanced-usage": {
    title: "Advanced Usage",
    order: 70,
    section: "Advanced",
    summary: "Provider tuning, rollout controls, and agent daemon usage patterns.",
    agentPriority: 6,
    tags: ["advanced", "provider", "release", "runtime", "agent"]
  }
};

function docsDirCandidates(): string[] {
  const candidates = [
    process.env.VIBENT_DOCS_DIR,
    path.join(process.cwd(), "docs"),
    path.join(process.cwd(), "..", "..", "docs"),
    path.join(process.cwd(), "..", "..", "..", "docs")
  ].filter((entry): entry is string => !!entry);
  return [...new Set(candidates.map((entry) => path.resolve(entry)))];
}

export function resolveDocsDir(): string | null {
  for (const candidate of docsDirCandidates()) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

export function listDocSlugs(): string[] {
  const docsDir = resolveDocsDir();
  if (!docsDir) return [];

  return fs
    .readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/i, ""))
    .sort((a, b) => a.localeCompare(b));
}

export function titleFromSlug(slug: string): string {
  const configured = DOC_META[slug]?.title;
  if (configured) return configured;
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getDocCatalog(): DocMeta[] {
  const slugs = listDocSlugs();
  const docs = slugs.map((slug) => {
    const configured = DOC_META[slug];
    if (configured) {
      return { slug, ...configured };
    }
    return {
      slug,
      title: titleFromSlug(slug),
      order: 1000,
      section: "Reference" as const,
      summary: "Additional repository documentation.",
      agentPriority: 1000,
      tags: ["reference"]
    };
  });

  return docs.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.title.localeCompare(right.title);
  });
}

export function getAgentReadingPath(): DocMeta[] {
  return getDocCatalog().sort((left, right) => {
    if (left.agentPriority !== right.agentPriority) return left.agentPriority - right.agentPriority;
    return left.order - right.order;
  });
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function filterDocsByTags(docs: DocMeta[], tags: string[]): DocMeta[] {
  const required = tags.map(normalizeTag).filter(Boolean);
  if (required.length === 0) return docs;
  return docs.filter((doc) => {
    const docTags = new Set(doc.tags.map(normalizeTag));
    return required.every((tag) => docTags.has(tag));
  });
}

export function collectAvailableTags(docs: DocMeta[]): string[] {
  return [...new Set(docs.flatMap((doc) => doc.tags.map(normalizeTag)))].sort((a, b) => a.localeCompare(b));
}

export function readDocBySlug(slug: string): string | null {
  if (!DOC_SLUG_PATTERN.test(slug)) return null;
  const docsDir = resolveDocsDir();
  if (!docsDir) return null;
  const filePath = path.join(docsDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}
