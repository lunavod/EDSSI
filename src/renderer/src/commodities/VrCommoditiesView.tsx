import { PinnedCard, type Whereabouts } from './PlanCard';
import { usePinnedPlan } from './useCommodities';

/**
 * The Commodities tab in the VR cockpit: only the pinned plan, since that is what is being flown.
 * The list, the searches and the planning all want a pointer, so they stay on the desk.
 */
export function VrCommoditiesView({ where }: { where: Whereabouts }) {
  const pinned = usePinnedPlan();
  return (
    <section className="comm-page" aria-label="Pinned plan">
      {pinned ? (
        <PinnedCard pinned={pinned} where={where} />
      ) : (
        <p className="comm-empty">No shopping plan is pinned.</p>
      )}
    </section>
  );
}
