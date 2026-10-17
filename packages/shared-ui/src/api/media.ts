import { getApiBaseUrl } from '../config';

export function resolveMediaUrl(url: string | null | undefined, base: string = getApiBaseUrl()): string | null {
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}
