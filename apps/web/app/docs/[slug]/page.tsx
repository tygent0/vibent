import { readDocBySlug, titleFromSlug } from "../../../lib/docs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default async function DocDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = readDocBySlug(slug);
  if (!content) {
    return (
      <section>
        <h1>Doc Not Found</h1>
        <p>No documentation page exists for this route.</p>
        <a href="/docs">Back to docs</a>
      </section>
    );
  }

  return (
    <section>
      <h1>{titleFromSlug(slug)}</h1>
      <p className="mono">docs/{slug}.md</p>
      <div className="card">
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
      <a href="/docs">Back to docs</a>
    </section>
  );
}
