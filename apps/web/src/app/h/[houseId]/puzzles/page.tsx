import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getConfig } from '../../../../config';
import { readHousePuzzles } from '../../../../modules/stories/puzzles';
import { PuzzleReview } from './puzzle-review';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'House Puzzles | Between Moves',
  robots: { index: false, follow: false },
};

export default async function HousePuzzlesPage({
  params,
}: {
  params: Promise<{ houseId: string }>;
}) {
  const { houseId } = await params;
  if (!z.uuid().safeParse(houseId).success) return notFound();
  const request = new Request(new URL(`/h/${houseId}/puzzles`, getConfig().appOrigin), {
    headers: await headers(),
  });
  const board = await readHousePuzzles(request, houseId);
  if (board === null) return notFound();
  return (
    <PuzzleReview
      houseId={houseId}
      initial={{
        ...board,
        published: board.published.map((puzzle) => ({
          ...puzzle,
          publishedAt: puzzle.publishedAt.toISOString(),
        })),
      }}
    />
  );
}
