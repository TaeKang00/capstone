import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

// List preferences live only for this authenticated workspace. No customer data is persisted.
const ViewStateContext = createContext(null);
export function ViewStateProvider({ children }) {
  const cache = useRef(new Map());
  return (
    <ViewStateContext.Provider value={cache.current}>
      {children}
    </ViewStateContext.Provider>
  );
}
export function useViewState(page, key, initial) {
  const cache = useContext(ViewStateContext);
  const cacheKey = `${page}:${key}`;
  const [value, setValue] = useState(() =>
    cache?.has(cacheKey)
      ? cache.get(cacheKey)
      : typeof initial === "function"
        ? initial()
        : initial,
  );
  const update = useCallback(
    (next) => {
      setValue((previous) => {
        const result = typeof next === "function" ? next(previous) : next;
        cache?.set(cacheKey, result);
        return result;
      });
    },
    [cache, cacheKey],
  );
  return [value, update];
}
