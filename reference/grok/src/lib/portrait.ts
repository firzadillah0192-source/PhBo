import { createServerFn } from "@tanstack/react-start";

export type PortraitResult =
  | { ok: true; imageDataUrl: string }
  | { ok: false; error: string };

export const createPortrait = createServerFn({ method: "POST" })
  .validator((input: { experienceId: string; photoDataUrl: string }) => input)
  .handler(async ({ data }): Promise<PortraitResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "The studio is resting. Please try again in a moment.",
      };
    }

    if (!data.photoDataUrl?.startsWith("data:image/")) {
      return { ok: false, error: "We couldn't read that photograph." };
    }
    if (data.photoDataUrl.length > 6_000_000) {
      return {
        ok: false,
        error: "That photograph is a little too large. Try another frame.",
      };
    }

    const { DEFAULT_PROMPT, EXPERIENCE_PROMPTS } = await import(
      "./prompts.server.ts"
    );
    const prompt = EXPERIENCE_PROMPTS[data.experienceId] ?? DEFAULT_PROMPT;

    try {
      const res = await fetch("https://api.x.ai/v1/images/edits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-imagine-image-2.0",
          prompt,
          image: { url: data.photoDataUrl, type: "image_url" },
          aspect_ratio: "3:4",
          n: 1,
          quality: "low",
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        return {
          ok: false,
          error: "We couldn't finish this portrait.",
        };
      }

      const body = (await res.json()) as {
        data?: Array<{ url?: string; b64_json?: string }>;
        url?: string;
      };
      const item = body.data?.[0];
      if (item?.b64_json) {
        return {
          ok: true,
          imageDataUrl: `data:image/jpeg;base64,${item.b64_json}`,
        };
      }
      const url = item?.url ?? body.url;
      if (!url) {
        return { ok: false, error: "We couldn't finish this portrait." };
      }
      const imgRes = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!imgRes.ok) {
        return { ok: false, error: "We couldn't finish this portrait." };
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get("content-type") || "image/jpeg";
      return {
        ok: true,
        imageDataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      };
    } catch {
      return {
        ok: false,
        error: "We couldn't finish this portrait.",
      };
    }
  });
