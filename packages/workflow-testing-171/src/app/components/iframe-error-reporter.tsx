'use client';

// Simple error reporter for preview apps running in iframe
// Reports errors to parent window via postMessage
// Only enabled in development mode and when running in iframe

import { useEffect, useRef } from 'react';

interface IframeErrorPayload {
  type: 'runtime' | 'promise';
  message: string;
  stack?: string;
  url: string;
  userAgent: string;
  timestamp: number;
}

export function IframeErrorReporter() {
  const errorCountRef = useRef(0);
  const lastErrorTimeRef = useRef(0);
  const correlationIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Only enable if:
    // 1. Running in iframe (window.parent !== window)
    // 2. Development mode
    if (window.parent === window || process.env.NODE_ENV !== 'development') {
      return;
    }

    // Generate correlation ID for this iframe session
    correlationIdRef.current = crypto.randomUUID();

    const MAX_ERRORS_PER_MINUTE = 10;
    const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

    // Simple rate limiting: reset counter every minute
    const checkRateLimit = (): boolean => {
      const now = Date.now();
      if (now - lastErrorTimeRef.current > RATE_LIMIT_WINDOW_MS) {
        errorCountRef.current = 0;
        lastErrorTimeRef.current = now;
      }

      if (errorCountRef.current >= MAX_ERRORS_PER_MINUTE) {
        console.warn('[IframeErrorReporter] Rate limit reached, skipping error report');
        return false;
      }

      errorCountRef.current++;
      return true;
    };

    // Sanitize error message (simple version, max length)
    const sanitizeMessage = (msg: unknown): string => {
      const str = String(msg);
      return str.length > 2000 ? str.substring(0, 2000) + '...' : str;
    };

    // Sanitize stack trace (simple version, max length)
    const sanitizeStack = (stack?: string): string | undefined => {
      if (!stack) return undefined;
      return stack.length > 2000 ? stack.substring(0, 2000) + '...' : stack;
    };

    // Get parent origin safely
    const getParentOrigin = (): string => {
      // 1. Priority: Use environment variable (for production/staging)
      if (process.env.NEXT_PUBLIC_PLATFORM_URL) {
        return process.env.NEXT_PUBLIC_PLATFORM_URL;
      }

      // 2. Use referrer to extract parent window's origin
      if (document.referrer) {
        try {
          const url = new URL(document.referrer);
          return url.origin; // e.g., "https://nullshot.ai" or "http://localhost:3000"
        } catch (e) {
          console.warn('[IframeErrorReporter] Invalid referrer URL:', document.referrer);
        }
      }

      // 3. Fallback to '*' for development (when referrer might not be available)
      // This is safe because:
      // - Only enabled in development mode
      // - Parent window validates message type and source
      // - Error data is sanitized
      return '*';
    };

    // Report error to parent window
    const reportError = (payload: IframeErrorPayload) => {
      if (!checkRateLimit()) {
        return;
      }

      try {
        const parentOrigin = getParentOrigin();

        window.parent.postMessage(
          {
            type: 'iframe-error-report',
            source: 'preview-app',
            correlationId: correlationIdRef.current,
            payload,
          },
          parentOrigin
        );

        if (process.env.NODE_ENV === 'development') {
          console.log('[IframeErrorReporter] ✅ Reported error to parent:', payload.type);
        }
      } catch (e) {
        console.error('[IframeErrorReporter] ❌ Failed to report error to parent:', e);
      }
    };

    // Handle runtime errors
    const handleError = (event: ErrorEvent) => {
      reportError({
        type: 'runtime',
        message: sanitizeMessage(event.message),
        stack: sanitizeStack(event.error?.stack),
        url: location.href,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
      });
    };

    // Handle unhandled promise rejections
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportError({
        type: 'promise',
        message: sanitizeMessage(reason),
        stack: sanitizeStack(reason?.stack),
        url: location.href,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
      });
    };

    // Set up error handlers
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    if (process.env.NODE_ENV === 'development') {
      console.log('[IframeErrorReporter] ✅ Error reporting enabled for iframe');
    }

    // Cleanup
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  // This component doesn't render anything
  return null;
}

