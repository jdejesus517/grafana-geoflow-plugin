import { RefObject, useEffect, useState } from 'react';

/**
 * Whether the element is on screen or within `margin` of it. Where IntersectionObserver is
 * missing, the element counts as always on screen.
 */
export function useOnScreen(ref: RefObject<HTMLElement | null>, margin: string): boolean {
  const [onScreen, setOnScreen] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { rootMargin: margin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin]);

  return onScreen;
}
