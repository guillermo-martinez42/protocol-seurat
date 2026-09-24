export interface RetryState {
  attempt: number;
  loading: boolean;
  err: boolean;
}

export function retryNext(s: RetryState): RetryState {
  return { attempt: s.attempt + 1, loading: true, err: false };
}

export function retryInit(): RetryState {
  return { attempt: 0, loading: true, err: false };
}
