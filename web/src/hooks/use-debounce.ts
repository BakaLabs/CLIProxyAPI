import { useEffect, useState } from "react";

/** Debounce a fast-changing value (search inputs). */
export function useDebounce<T>(value: T, delayMS = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMS);
    return () => clearTimeout(timer);
  }, [value, delayMS]);
  return debounced;
}
