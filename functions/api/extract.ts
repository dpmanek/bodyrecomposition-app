interface Env {
  GEMINI_API_KEY: string;
  APP_ACCESS_KEY?: string;
}

const MODEL = 'gemini-1.5-flash';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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
  const base64 = toBase64(bytes);

  const prompt =
    'Extract body composition readings from this Omron monitor display image. Return JSON only. Use null for missing or unreadable values. Do not guess. Fields: weight, weightUnit, bmi, bodyFatPercent, skeletalMusclePercent, visceralFatLevel, restingMetabolismKcal, bodyAgeYears. Include confidence scores from 0 to 1 for each field. Return exactly this shape: {"values":{"weight":number|null,"weightUnit":"lb"|"kg"|null,"bmi":number|null,"bodyFatPercent":number|null,"skeletalMusclePercent":number|null,"visceralFatLevel":number|null,"restingMetabolismKcal":number|null,"bodyAgeYears":number|null},"confidence":{"weight":number,"weightUnit":number,"bmi":number,"bodyFatPercent":number,"skeletalMusclePercent":number,"visceralFatLevel":number,"restingMetabolismKcal":number,"bodyAgeYears":number}}';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
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
              { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    return json({ error: `Gemini request failed: ${await response.text()}` }, response.status);
  }

  const gemini = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = gemini.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) return json({ error: 'Gemini returned no text' }, 502);

  try {
    return json(normalizeExtraction(JSON.parse(text)));
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
