import {
  FIXED_MVP_POINTS_RECIPE,
  type PointsRecipe as PointsRecipeValue,
} from '@between-moves/domain';

/** [BM-019] [DR-SEASON-02] Explain the immutable MVP points snapshot without editable controls. */
export function PointsRecipe({
  recipe = FIXED_MVP_POINTS_RECIPE,
}: {
  readonly recipe?: PointsRecipeValue;
}) {
  return (
    <section className="charter-points" aria-labelledby="charter-points-title">
      <h2 id="charter-points-title">Season points</h2>
      <p>The MVP points recipe is fixed, so every House plays by the same recipe.</p>
      <ul>
        <li>{recipe.completedGame} point to each Member for a completed Game</li>
        <li>
          {recipe.win} more points to the winner; {recipe.draw} more to each Member for a draw
        </li>
        <li>
          {recipe.nightAttendance} point per Between Moves Night, up to {recipe.caps.nights}
        </li>
        <li>
          {recipe.publishedPuzzle} point per published House Puzzle, up to {recipe.caps.puzzles}
        </li>
        <li>Only the first {recipe.caps.games} completed Games per Member score</li>
      </ul>
    </section>
  );
}
