import type { Metadata } from 'next';
import { renderGamePage } from '../game-page';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Live Game | Between Moves',
  robots: { index: false, follow: false },
};

/** [BM-042] Keep live play within the existing House authorization boundary. */
export default async function LiveGamePage(props: {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}) {
  return renderGamePage(props, true);
}
