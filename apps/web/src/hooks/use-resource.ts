import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
export function useResource<T>(path: string, interval = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await api<T>(path);
      if (version !== requestVersion.current) return;
      setData(result);
      setError("");
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(e instanceof Error ? e.message : "Request failed");
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    if (interval) {
      const visibleRefresh = () => {
        if (document.visibilityState === "visible") void refresh();
      };
      const timer = setInterval(visibleRefresh, interval);
      document.addEventListener("visibilitychange", visibleRefresh);
      return () => {
        requestVersion.current++;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", visibleRefresh);
      };
    }
    return () => {
      requestVersion.current++;
    };
  }, [refresh, interval]);
  return { data, error, refresh };
}
