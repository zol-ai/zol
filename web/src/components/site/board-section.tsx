import { Board } from "./board";
import { Reveal } from "./reveal";
import { AttributionLegend } from "./tag";

/**
 * The board gets its own band now that the hero is carried by imagery. It's
 * still the first thing after the fold — the product, before the pitch.
 */
export function BoardSection() {
  return (
    <section className="band-tight border-t border-line bg-paper-2">
      <div className="shell">
        <Reveal>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="t-eyebrow">The board, this morning</p>
              <h2 className="t-h3 mt-3 text-[1.375rem] sm:text-[1.625rem]">
                Every job, and who moved it last
              </h2>
            </div>
            <AttributionLegend />
          </div>
          <Board />
        </Reveal>
      </div>
    </section>
  );
}
