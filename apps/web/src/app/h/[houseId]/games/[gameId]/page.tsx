import type { Metadata } from 'next';
import { renderGamePage } from './game-page';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Game | Between Moves',
  robots: { index: false, follow: false },
};

export default async function GamePage(props: {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}) {
  return renderGamePage(props);
}
