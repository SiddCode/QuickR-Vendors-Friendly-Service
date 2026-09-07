import { useState, useEffect } from 'react';

export interface RateLimitInfo {
  isRateLimited: boolean;
  message: string | null;
  retryAfterSeconds: number;
  retryAt: string | null;
  isQuotaExceeded?: boolean;
}

export function useAiRateLimit() {
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo>({
    isRateLimited: false,
    message: null,
    retryAfterSeconds: 0,
    retryAt: null,
    isQuotaExceeded: false
  });

  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  // Set rate limit state from API error response or Error object
  const triggerRateLimit = (err: any) => {
    const errorBody = err?.errorBody || err?.response || err;
    const retryAfter = err?.retryAfterSeconds ?? errorBody?.retryAfterSeconds ?? 60;
    const retryAtIso = err?.retryAt ?? errorBody?.retryAt ?? null;
    const isQuota = err?.error === 'QUOTA_EXCEEDED' || errorBody?.error === 'QUOTA_EXCEEDED';
    const msg = err?.userMessage || err?.message || errorBody?.message || 'AI service is temporarily rate limited.';

    setRateLimitInfo({
      isRateLimited: true,
      message: msg,
      retryAfterSeconds: isQuota ? 0 : retryAfter,
      retryAt: retryAtIso,
      isQuotaExceeded: isQuota
    });

    if (!isQuota) {
      if (retryAtIso) {
        const secs = Math.max(0, Math.ceil((new Date(retryAtIso).getTime() - Date.now()) / 1000));
        setRemainingSeconds(secs > 0 ? secs : retryAfter);
      } else {
        setRemainingSeconds(retryAfter);
      }
    } else {
      setRemainingSeconds(0);
    }
  };

  const clearRateLimit = () => {
    setRateLimitInfo({
      isRateLimited: false,
      message: null,
      retryAfterSeconds: 0,
      retryAt: null,
      isQuotaExceeded: false
    });
    setRemainingSeconds(0);
  };

  useEffect(() => {
    if (!rateLimitInfo.isRateLimited || rateLimitInfo.isQuotaExceeded || remainingSeconds <= 0) {
      return;
    }

    const timer = setInterval(() => {
      if (rateLimitInfo.retryAt) {
        const secs = Math.max(0, Math.ceil((new Date(rateLimitInfo.retryAt).getTime() - Date.now()) / 1000));
        setRemainingSeconds(secs);
      } else {
        setRemainingSeconds((prev) => Math.max(0, prev - 1));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [rateLimitInfo.isRateLimited, rateLimitInfo.isQuotaExceeded, rateLimitInfo.retryAt, remainingSeconds]);

  return {
    rateLimitInfo,
    remainingSeconds,
    triggerRateLimit,
    clearRateLimit
  };
}
