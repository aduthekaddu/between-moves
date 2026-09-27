import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AppMasthead } from '../../../_components/app-masthead';
import { getConfig } from '../../../../config';
import { readHouseClosingBook } from '../../../../modules/stories/closingBook';
import { ClosingBookView } from './closing-book-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Closing Book | Between Moves',
  robots: { index: false, follow: false },
};

/**
 * [BM-048] Render the House's latest Closing Book for an active Member. Anyone else sees the
 * neutral House not-found page, so the book never confirms that a House exists.
 */
export default async function ClosingBookPage({
  params,
}: {
  params: Promise<{ houseId: string }>;
}) {
  const { houseId } = await params;
  if (!z.uuid().safeParse(houseId).success) notFound();
  const request = new Request(new URL(`/h/${houseId}/closing-book`, getConfig().appOrigin), {
    headers: await headers(),
  });
  const shelf = await readHouseClosingBook(request, houseId);
  if (shelf === null) notFound();
  return (
    <div className="closing-book-shell">
      <AppMasthead houseId={houseId} houseName={shelf.houseName} current="season" />
      <main className="closing-book-main">
        <ClosingBookView shelf={shelf} />
      </main>
    </div>
  );
}
