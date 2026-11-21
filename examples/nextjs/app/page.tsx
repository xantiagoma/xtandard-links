/** Your own page: the middleware lets `/` through (no `rootUrl` on the domain). */
export default function Home() {
  return (
    <main>
      <h1>Acme</h1>
      <p>
        Open <a href="/links">the links panel</a>, create a link (say <code>docs</code>), then visit{" "}
        <a href="/docs">/docs</a> — the middleware redirects it and records the click.
      </p>
    </main>
  );
}
