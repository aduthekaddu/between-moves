'use client';

import { useState, type FormEvent } from 'react';
import { AppMasthead } from '../../../_components/app-masthead';
import { PositionBoard } from '../../../_components/position-board';

type Candidate = { id: string; gameId: string; sourcePly: number; positionFen: string };
type Puzzle = {
  id: string;
  prompt: string;
  positionFen: string;
  contributorName: string;
  publishedAt: string;
};

export function PuzzleReview({
  houseId,
  initial,
}: {
  houseId: string;
  initial: { candidates: readonly Candidate[]; published: readonly Puzzle[] };
}) {
  const [candidates, setCandidates] = useState<readonly Candidate[]>(initial.candidates);
  const [published, setPublished] = useState<readonly Puzzle[]>(initial.published);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function publish(event: FormEvent<HTMLFormElement>, candidate: Candidate) {
    event.preventDefault();
    const prompt = prompts[candidate.id]?.trim() ?? '';
    if (pendingId !== null || !confirmed[candidate.id] || prompt.length < 1 || prompt.length > 280)
      return;
    setPendingId(candidate.id);
    setMessage('Publishing House Puzzle…');
    try {
      const response = await fetch(`/api/houses/${encodeURIComponent(houseId)}/puzzles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.id, prompt, positionConfirmed: true }),
      });
      if (!response.ok) throw new Error('Publication failed');
      const puzzle = (await response.json()) as Puzzle;
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
      setPublished((current) => [puzzle, ...current]);
      setMessage('House Puzzle published. Contributor points are capped at two per Season.');
    } catch {
      setMessage('The House Puzzle could not be published. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="puzzle-shell">
      <AppMasthead houseId={houseId} current="puzzles" />
      <main className="puzzle-main">
        <div className="puzzle-heading">
          <p className="house-home__eyebrow">From the games we played</p>
          <h1>House Puzzles</h1>
          <p>Choose a moment, check the position, and write a prompt for your House.</p>
        </div>
        <p className="puzzle-message" role="status" aria-live="polite">
          {message}
        </p>
        <section aria-labelledby="pending-puzzles">
          <h2 id="pending-puzzles">Ready for a member’s eye</h2>
          {candidates.length === 0 ? (
            <p>No positions waiting for review.</p>
          ) : (
            <div className="puzzle-list">
              {candidates.map((candidate) => (
                <article className="puzzle-card" key={candidate.id}>
                  <div>
                    <p className="house-home__eyebrow">Game moment · move {candidate.sourcePly}</p>
                    <h3>Review this position</h3>
                    <p>Position before the move. The House will see this exact board.</p>
                    <PositionBoard fen={candidate.positionFen} />
                    <code className="puzzle-fen">{candidate.positionFen}</code>
                  </div>
                  <form onSubmit={(event) => void publish(event, candidate)}>
                    <label className="puzzle-check">
                      <input
                        type="checkbox"
                        checked={confirmed[candidate.id] ?? false}
                        onChange={(event) =>
                          setConfirmed((current) => ({
                            ...current,
                            [candidate.id]: event.target.checked,
                          }))
                        }
                      />
                      I confirm this position is right for a House Puzzle.
                    </label>
                    <label htmlFor={`puzzle-prompt-${candidate.id}`}>Prompt for the House</label>
                    <textarea
                      id={`puzzle-prompt-${candidate.id}`}
                      required
                      maxLength={280}
                      value={prompts[candidate.id] ?? ''}
                      onChange={(event) =>
                        setPrompts((current) => ({
                          ...current,
                          [candidate.id]: event.target.value,
                        }))
                      }
                      placeholder="What would you play here?"
                    />
                    <p className="puzzle-hint">
                      Ask a clear question. Your name will appear as contributor.
                    </p>
                    <button
                      type="submit"
                      disabled={
                        pendingId !== null ||
                        !confirmed[candidate.id] ||
                        !prompts[candidate.id]?.trim()
                      }
                    >
                      {pendingId === candidate.id ? 'Publishing…' : 'Confirm & publish'}
                    </button>
                  </form>
                </article>
              ))}
            </div>
          )}
        </section>
        <section aria-labelledby="published-puzzles">
          <h2 id="published-puzzles">At the House table</h2>
          {published.length === 0 ? (
            <p>Published puzzles will appear here for House members.</p>
          ) : (
            <div className="puzzle-list">
              {published.map((puzzle) => (
                <article className="puzzle-card puzzle-card--published" key={puzzle.id}>
                  <div>
                    <p className="house-home__eyebrow">Published House Puzzle</p>
                    <h3>{puzzle.prompt}</h3>
                    <p>Contributed by {puzzle.contributorName}</p>
                  </div>
                  <PositionBoard fen={puzzle.positionFen} />
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
