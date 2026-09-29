import Link from 'next/link';
import { BrandMark } from '../../_components/brand-mark';

export default function InvalidMagicLinkPage() {
  return (
    <main className="house-unavailable house-unavailable--night">
      <section className="house-unavailable__sheet" aria-labelledby="link-invalid-title">
        <BrandMark className="house-unavailable__mark" />
        <p className="house-home__eyebrow">Sign-in link</p>
        <h1 id="link-invalid-title">This sign-in link is no longer valid</h1>
        <p>Request a new link to continue. For your privacy, no account details are shown.</p>
        <Link href="/sign-in">Request a new sign-in link</Link>
      </section>
    </main>
  );
}
