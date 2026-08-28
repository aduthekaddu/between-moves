import { siteMetadata } from '../lib/site-metadata';

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing__card" aria-labelledby="landing-title">
        <p className="landing__eyebrow">A private chess house</p>
        <h1 id="landing-title" className="landing__title">
          {siteMetadata.name}
        </h1>
        <p className="landing__tagline">{siteMetadata.tagline}</p>
        <p className="landing__promise">{siteMetadata.description}</p>
      </section>
    </main>
  );
}
