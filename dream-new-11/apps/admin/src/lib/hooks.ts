import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Page } from '@dream11/shared';
import { useToast } from '@/components/ui';
import { api, qs } from './api';

/** Cursor-paginated admin list with filters; `items` is every loaded page. */
export function usePaged<T>(path: string, filters: Record<string, string | undefined>) {
  const q = useInfiniteQuery({
    queryKey: [path, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<T>>(`${path}${qs({ ...filters, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.items) ?? [] };
}

/** A mutation that toasts and refreshes the given query keys on success. */
export function useAction<V, R = unknown>(fn: (v: V) => Promise<R>, opts: { success?: string; invalidate?: string[] } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (opts.success) toast.success(opts.success);
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
