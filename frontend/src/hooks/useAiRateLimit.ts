import { useState, useEffect } from 'react';

export interface RateLimitInfo {
  isRateLimited: boolean;
  message: string | null;
  retryAfterSeconds: number | null;
  resetAt: string | null;
  retryAt: string | null;
  isQuotaExceeded?: boolean;
}

export function useAiRateLimit() {
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo>({
    isRateLimited: false,
    message: null,
    retryAfterSeconds: null,
    resetAt: null,
    retryAt: null,
    isQuotaExceeded: false
  });

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // Set rate limit state from API error response or Error object
  const triggerRateLimit = (err: any) => {
    const errorBody = err?.errorBody || err?.response || err;
    
    // Extract retryAfterSeconds if valid number
    let rawSecs: number | null = null;
    const candidateSecs = err?.retryAfterSeconds ?? errorBody?.retryAfterSeconds;
    if (typeof candidateSecs === 'number' && !isNaN(candidateSecs) && candidateSecs > 0) {
      rawSecs = candidateSecs;
    }

    const resetAtIso = err?.resetAt ?? errorBody?.resetAt ?? err?.retryAt ?? errorBody?.retryAt ?? null;
    const isQuota = err?.errorCode === 'QUOTA_EXCEEDED' || errorBody?.error === 'QUOTA_EXCEEDED';
    const msg = err?.userMessage || err?.message || errorBody?.message || 'Rate limit reached. Please try again shortly.';

    let calculatedSecs: number | null = rawSecs;

    if (resetAtIso && !isQuota) {
      const parsedTime = Date.parse(resetAtIso);
      if (!isNaN(parsedTime)) {
        const diff = Math.max(0, Math.ceil((parsedTime - Date.now()) / 1000));
        calculatedSecs = diff > 0 ? diff : (rawSecs || null);
      }
    }

    setRateLimitInfo({
      isRateLimited: true,
      message: msg,
      retryAfterSeconds: isQuota ? null : calculatedSecs,
      resetAt: resetAtIso,
      retryAt: resetAtIso,
      isQuotaExceeded: isQuota
    });

    setRemainingSeconds(isQuota ? null : calculatedSecs);
  };

  const clearRateLimit = () => {
    setRateLimitInfo({
      isRateLimited: false,
      message: null,
      retryAfterSeconds: null,
      resetAt: null,
      retryAt: null,
      isQuotaExceeded: false
    });
    setRemainingSeconds(null);
  };

  useEffect(() => {
    if (!rateLimitInfo.isRateLimited || rateLimitInfo.isQuotaExceeded || remainingSeconds === null) {
      return;
    }

    if (remainingSeconds <= 0) {
      return;
    }

    const timer = setInterval(() => {
      if (rateLimitInfo.resetAt || rateLimitInfo.retryAt) {
        const targetTime = rateLimitInfo.resetAt || rateLimitInfo.retryAt;
        const parsedTime = Date.parse(targetTime!);
        if (!isNaN(parsedTime)) {
          const secs = Math.max(0, Math.ceil((parsedTime - Date.now()) / 1000));
          setRemainingSeconds(secs);
          return;
        }
      }
      setRemainingSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [rateLimitInfo.isRateLimited, rateLimitInfo.isQuotaExceeded, rateLimitInfo.resetAt, rateLimitInfo.retryAt, remainingSeconds]);

  return {
    rateLimitInfo,
    remainingSeconds,
    triggerRateLimit,
    clearRateLimit
  };
}
