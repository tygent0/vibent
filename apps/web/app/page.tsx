import Link from "next/link";

export default function HomePage() {
  return (
    <section className="hero">
      <h1>vibent</h1>
      <p>git + x-ray vision for AI-assisted coding.</p>
      <div className="card">
        <h2>Core commands</h2>
        <p className="mono">
          vibent session start | run | verify | review | publish --mode direct | release create | signal add
        </p>
      </div>
      <div className="grid">
        <div className="card">
          <h2>10-minute setup</h2>
          <p>Run locally first. Connect GitHub only when you are ready to publish evidence.</p>
        </div>
        <div className="card">
          <h2>One check + one comment</h2>
          <p>Minimal GitHub noise with a rolling evidence summary.</p>
        </div>
      </div>
      <p>
        <Link href="/signin">Sign in with GitHub</Link>
      </p>
    </section>
  );
}
