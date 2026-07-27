import { useCallback, useEffect, useState } from 'react';
import { businessesService } from '../services/businessesService.ts';
import type { Business } from '../data/types.ts';

type Status = 'loading' | 'success' | 'error';

interface UseBusinessesState {
  status: Status;
  data: Business[];
  error: Error | null;
}

interface UseBusinessesReturn extends UseBusinessesState {
  retry: () => void;
}

export function useBusinesses(): UseBusinessesReturn {
  const [state, setState] = useState<UseBusinessesState>({
    status: 'loading',
    data: [],
    error: null,
  });
  const [requestVersion, setRequestVersion] = useState(0);

  const retry = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading' as Status, error: null }));
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    businessesService
      .list({ signal: controller.signal })
      .then((data) => {
        setState({ status: 'success', data, error: null });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error', data: [], error: error instanceof Error ? error : new Error(String(error)) });
      });

    return () => controller.abort();
  }, [requestVersion]);

  return { ...state, retry };
}
