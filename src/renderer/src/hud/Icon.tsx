/** An SVG drawn in the current text colour (the SVG is used as a mask). */
export function Icon({ src, className = 'icon' }: { src: string; className?: string }) {
  return <span className={className} style={{ maskImage: `url("${src}")` }} aria-hidden="true" />;
}
