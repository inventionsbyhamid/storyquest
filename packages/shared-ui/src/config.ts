export const DEFAULT_API_BASE_URL = 'http://localhost:8080';

let apiBaseUrl = DEFAULT_API_BASE_URL;

export function setApiBaseUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed) apiBaseUrl = trimmed;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}
