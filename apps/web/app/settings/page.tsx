export default function SettingsPage() {
  return (
    <section>
      <h1>Settings</h1>
      <div className="card">
        <h2>Connected repos</h2>
        <p>Managed through GitHub App installation.</p>
      </div>
      <div className="card">
        <h2>Artifact retention</h2>
        <p>Default: 14 days, published bundles: 90 days, pin supported.</p>
      </div>
      <div className="card">
        <h2>Personal tokens</h2>
        <p>Keep tokens in Secret Manager in production. Never plaintext.</p>
      </div>
    </section>
  );
}
