import type { AccountSummary, MembershipRole } from '@between-moves/domain';
import Link from 'next/link';
import { BrandMark } from '../_components/brand-mark';
import { CreateHouseForm } from './create-house-form';
import { DeleteAccountPanel } from './delete-account-panel';
import { SignOutButton } from './sign-out-button';

const ROLES: Readonly<Record<MembershipRole, string>> = {
  owner: 'Owner',
  steward: 'Steward',
  member: 'Member',
};

/**
 * [BM-050] The account page: the person's Houses, a download of their own data, and the
 * irreversible deletion that leaves the House's shared history in place.
 */
export function AccountView({ summary }: { readonly summary: AccountSummary }) {
  const owned = summary.houses.filter((house) => house.role === 'owner');
  return (
    <div className="house-shell account-shell">
      <header className="app-masthead">
        <Link className="app-masthead__brand" href="/">
          <BrandMark className="app-masthead__mark" />
          <span className="app-masthead__names">
            <span className="app-masthead__product">Between Moves</span>
            <span className="app-masthead__house">Your account</span>
          </span>
        </Link>
      </header>

      <main className="account-page">
        <section className="account-intro" aria-labelledby="account-title">
          <span
            className="bm-puppet account-intro__art"
            data-puppet="lamplighter"
            aria-hidden="true"
          />
          <p className="house-home__eyebrow">Your account</p>
          <h1 id="account-title">{summary.displayName}</h1>
          <SignOutButton />
        </section>

        <section className="account-section" aria-labelledby="account-create-title">
          <h2 id="account-create-title">Start a House</h2>
          <p className="account-section__copy">
            Give your group a private table. You can invite Members after the House opens.
          </p>
          <CreateHouseForm />
        </section>

        <section className="account-section" aria-labelledby="account-houses-title">
          <h2 id="account-houses-title">Your Houses</h2>
          {summary.houses.length === 0 ? (
            <p className="account-section__copy">You are not a Member of any House right now.</p>
          ) : (
            <ul className="account-houses">
              {summary.houses.map((house) => (
                <li key={house.houseId}>
                  <a href={`/h/${encodeURIComponent(house.houseId)}`}>{house.name}</a>
                  <span className="account-houses__role">{ROLES[house.role]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="account-section" aria-labelledby="account-export-title">
          <h2 id="account-export-title">Download your data</h2>
          <p className="account-section__copy">
            One JSON file with your profile, your memberships, the chat messages, Game notes,
            reactions and Puzzles you wrote, the Games you played and your Moves in them, and the
            Season points you earned. It holds nothing written by other Members.
          </p>
          <a className="account-download" href="/api/account/export" download>
            Download your data
          </a>
        </section>

        <DeleteAccountPanel ownedHouses={owned.map((house) => house.name)} />
      </main>
    </div>
  );
}
