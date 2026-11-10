import { useEffect, useState } from "react";

// Phone layout switch. Pages render a different layout below 640px, so this
// is a JS check rather than CSS: the two layouts must not both be in the DOM.
export const PHONE_QUERY = "(max-width: 640px)";
export function useMediaQuery(query = PHONE_QUERY) {
  const read = () =>
    typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

