import { handleSyncRequest } from './sync-api';
import { handleGoogleHealthRequest } from './google-health-api';

interface Env {
  ASSETS: Fetcher;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  APP_ACCESS_KEY?: string;
  DB?: D1Database;
  GOOGLE_HEALTH_CLIENT_ID?: string;
  GOOGLE_HEALTH_CLIENT_SECRET?: string;
  GOOGLE_HEALTH_REDIRECT_URI?: string;
  GOOGLE_HEALTH_TOKEN_KEY?: string;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/extract') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      return extract(request, env);
    }

    if (url.pathname === '/api/sync') {
      return handleSyncRequest(request, env);
    }

    if (url.pathname.startsWith('/api/google-health/')) {
      return handleGoogleHealthRequest(request, env, url.pathname);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;

const extract = async (request: Request, env: Env) => {
  if (env.APP_ACCESS_KEY && request.headers.get('x-app-access-key') !== env.APP_ACCESS_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY is not configured' }, 500);
  }

  const formData = await request.formData();
  const file = formData.get('image');
  if (!(file instanceof File)) {
    return json({ error: 'Missing image file' }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;

  const prompt =
    'Extract readings from an Omron HBF-306C handheld fat loss monitor display image. This model commonly shows FAT percent and BMI. Return JSON only. Use null for missing or unreadable values. Do not guess or infer values from profile labels. Fields: weight, weightUnit, bmi, bodyFatPercent, skeletalMusclePercent, visceralFatLevel, restingMetabolismKcal, bodyAgeYears. Include confidence scores from 0 to 1 for each field. Return exactly this shape: {"values":{"weight":number|null,"weightUnit":"lb"|"kg"|null,"bmi":number|null,"bodyFatPercent":number|null,"skeletalMusclePercent":number|null,"visceralFatLevel":number|null,"restingMetabolismKcal":number|null,"bodyAgeYears":number|null},"confidence":{"weight":number,"weightUnit":number,"bmi":number,"bodyFatPercent":number,"skeletalMusclePercent":number,"visceralFatLevel":number,"restingMetabolismKcal":number,"bodyAgeYears":number}}';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: file.type || 'image/jpeg', data: toBase64(bytes) } },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    return json(
      {
        error: 'Gemini request failed',
        detail: summarizeGeminiError(await response.text()),
        model,
      },
      response.status,
    );
  }

  const gemini = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = gemini.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) return json({ error: 'Gemini returned no text' }, 502);

  try {
    return json(normalizeExtraction(JSON.parse(stripJsonFence(text))));
  } catch {
    return json({ error: 'Gemini did not return valid JSON', raw: text }, 502);
  }
};

const normalizeExtraction = (input: Record<string, unknown>) => ({
  values: typeof input.values === 'object' && input.values ? input.values : input,
  confidence: typeof input.confidence === 'object' && input.confidence ? input.confidence : {},
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const stripJsonFence = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

const summarizeGeminiError = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } };
    return [parsed.error?.status, parsed.error?.message].filter(Boolean).join(': ') || raw;
  } catch {
    return raw;
  }
};
