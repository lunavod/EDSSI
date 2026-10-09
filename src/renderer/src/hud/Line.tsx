/** The glowing HUD rule between regions of the window. */
export function Line({ vertical = false }: { vertical?: boolean }) {
  return vertical ? <hr className="rule-v" aria-orientation="vertical" /> : <hr className="rule" />;
}
