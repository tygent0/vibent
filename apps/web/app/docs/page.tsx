import { getAgentReadingPath, getDocCatalog } from "../../lib/docs";

export default function DocsPage() {
  const docs = getDocCatalog();
  const docsBySection = new Map<string, typeof docs>();
  for (const doc of docs) {
    docsBySection.set(doc.section, [...(docsBySection.get(doc.section) ?? []), doc]);
  }
  const sectionOrder = ["Start Here", "Core Concepts", "Integration", "Advanced", "Reference"];
  const agentPath = getAgentReadingPath().slice(0, 6);

  return (
    <section>
      <h1>Docs</h1>
      <p>Project documentation bundled with this repository, ordered for practical onboarding.</p>
      {docs.length === 0 ? <p>No docs found.</p> : null}
      {agentPath.length > 0 ? (
        <>
          <h2>Agent Reading Path</h2>
          <div className="card">
            {agentPath.map((doc, index) => (
              <p key={doc.slug}>
                {index + 1}. <a href={`/docs/${doc.slug}`}>{doc.title}</a>
              </p>
            ))}
            <p className="mono">Machine manifest: /docs/manifest</p>
          </div>
        </>
      ) : null}
      {sectionOrder
        .filter((section) => (docsBySection.get(section) ?? []).length > 0)
        .map((section) => (
          <div key={section}>
            <h2>{section}</h2>
            {(docsBySection.get(section) ?? []).map((doc) => (
              <div className="card" key={doc.slug}>
                <strong>{doc.title}</strong>
                <p>{doc.summary}</p>
                <p>
                  {doc.tags.map((tag) => (
                    <code key={tag} style={{ marginRight: 6 }}>
                      {tag}
                    </code>
                  ))}
                </p>
                <p className="mono">{doc.slug}.md</p>
                <a href={`/docs/${doc.slug}`}>Open</a>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}
