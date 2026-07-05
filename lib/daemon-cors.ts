import type { FastifyRequest } from 'fastify';

type CorsOptionsCallback = (
  error: Error | null,
  corsOptions?: { origin: boolean; credentials: boolean },
) => void;

const DASHBOARD_CORS_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|dashboard\.pd\.local)(:\d+)?$/;
const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

export function isVisualTaskCorsPath(url: string | undefined): boolean {
  return url === '/visual-tasks' || url?.startsWith('/visual-tasks?') === true;
}

export function resolveDaemonCorsOrigin(origin: string | undefined, requestUrl: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (DASHBOARD_CORS_ORIGIN_RE.test(origin)) {
    return true;
  }

  return isVisualTaskCorsPath(requestUrl) && CHROME_EXTENSION_ORIGIN_RE.test(origin);
}

export function createDaemonCorsOptions() {
  return {
    credentials: true,
    delegator(request: FastifyRequest, callback: CorsOptionsCallback): void {
      callback(null, {
        origin: resolveDaemonCorsOrigin(request.headers.origin, request.url),
        credentials: true,
      });
    },
  };
}
