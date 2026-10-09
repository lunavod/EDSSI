/**
 * A species' three samples as squares, filled as each is taken; all three green once analysed.
 * `progress` is a BioLine's: "2/3", "analysed", "sold", "lost", or "—" before sampling starts.
 */
export function Pips({ progress, large = false }: { progress: string; large?: boolean }) {
  const done = progress === 'analysed' || progress === 'sold';
  const taken = done ? 3 : Number(/^(\d)\/3$/.exec(progress)?.[1] ?? 0);
  const className = ['pips', done && 'done', large && 'lg'].filter(Boolean).join(' ');
  return (
    <span className={className} title={progress}>
      {[0, 1, 2].map((index) => (
        <i key={index} className={index < taken ? 'on' : undefined} />
      ))}
      <span className="visually-hidden">{taken} of 3 samples</span>
    </span>
  );
}
