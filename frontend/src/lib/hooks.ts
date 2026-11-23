'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';
import type { ApiResult } from './types';

export interface ActionState<T> {
  loading: boolean;
  result: ApiResult<T> | null;
  error: string | null;
}

/** Chạy một lời gọi API, giữ trạng thái đang chạy / kết quả / lỗi để hiển thị. */
export function useAction<T, A extends unknown[]>(fn: (...args: A) => Promise<ApiResult<T>>) {
  const [state, setState] = useState<ActionState<T>>({ loading: false, result: null, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A) => {
    setState(s => ({ ...s, loading: true, error: null }));
    const result = await fnRef.current(...args);
    setState({ loading: false, result, error: result.ok ? null : errorMessage(result) });
    return result;
  }, []);

  const reset = useCallback(() => setState({ loading: false, result: null, error: null }), []);
  return { ...state, run, reset };
}

/** Gọi lại hàm theo chu kỳ khi enabled = true. */
export function useInterval(callback: () => void, ms: number, enabled = true) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

/** Tránh lệch giao diện giữa server và client khi dữ liệu lấy từ localStorage. */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
