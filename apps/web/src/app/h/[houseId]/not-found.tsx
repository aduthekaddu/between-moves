/** [BM-013] [UX-STATE-07] Neutral House denial without tenant details. */
export default function HouseNotFound() {
  return (
    <main className="house-unavailable">
      <section className="house-unavailable__sheet" aria-labelledby="house-unavailable-title">
        <p className="house-home__eyebrow">Between Moves</p>
        <h1 id="house-unavailable-title">This House is not available.</h1>
        <p>It may not exist, or your membership may not include it.</p>
      </section>
    </main>
  );
}
