import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/** The size EDSSI's window is laid out for (see the stylesheets' px sizes). */
export const WINDOW = { width: 1446, height: 900 };

/**
 * Draws `children` at the window's own size and scales it down to fit the width it's given, so a
 * screen reads as the app does rather than reflowed into a box it was never laid out for. Mounts
 * them only once near the viewport: each is a whole EDSSI.
 */
export function Scaled({
  children,
  height = WINDOW.height,
}: {
  children: ReactNode;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [near, setNear] = useState(false);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    // Measured now as well as on change: the observers say nothing while the page is hidden.
    const first = element.getBoundingClientRect();
    setScale(first.width / WINDOW.width);
    if (first.top < window.innerHeight + 600) setNear(true);
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / WINDOW.width);
    });
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: '600px 0px' },
    );
    resize.observe(element);
    seen.observe(element);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, []);

  return (
    <div ref={box} className="scaled" style={{ height: height * scale }}>
      {near && scale > 0 && (
        <div
          className="scaled-inner"
          style={{ width: WINDOW.width, height, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
