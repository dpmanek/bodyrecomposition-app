import type { GoogleHealthStatus } from '../types';

const headers = (accessKey: string, jsonBody = false) => ({
  'x-app-access-key': accessKey.trim(),
  ...(jsonBody ? { 'content-type': 'application/json' } : {}),
});

export const getGoogleHealthStatus = async (accessKey: string, profileId: string) => {
  const response = await fetch(`/api/google-health/status?profileId=${encodeURIComponent(profileId)}`, {
    headers: headers(accessKey),
    cache: 'no-store',
  });
  return healthResponse<GoogleHealthStatus>(response);
};

export const beginGoogleHealthConnection = async (accessKey: string, profileId: string) => {
  const response = await fetch('/api/google-health/connect', {
    method: 'POST',
    headers: headers(accessKey, true),
    body: JSON.stringify({ profileId }),
  });
  return healthResponse<{ authorizationUrl: string }>(response);
};

export const syncGoogleHealth = async (accessKey: string, profileId: string) => {
  const response = await fetch('/api/google-health/sync', {
    method: 'POST',
    headers: headers(accessKey, true),
    body: JSON.stringify({ profileId, endDate: localDay() }),
  });
  return healthResponse<GoogleHealthStatus>(response);
};

export const disconnectGoogleHealth = async (accessKey: string, profileId: string) => {
  const response = await fetch('/api/google-health/disconnect', {
    method: 'DELETE',
    headers: headers(accessKey, true),
    body: JSON.stringify({ profileId }),
  });
  return healthResponse<GoogleHealthStatus>(response);
};

const healthResponse = async <T>(response: Response): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || 'Google Health request failed');
  return body;
};

const localDay = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
