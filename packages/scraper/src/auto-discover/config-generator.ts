import OpenAI from "openai";
import type { StoreDefinition } from "@bestdeal/shared";
import type { ExtractedLink } from "./link-discovery-service.ts";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.ts";

/**
 * Call OpenAI to generate a StoreDefinition from extracted links.
 */
export async function generateStoreConfig(options: {
  storeName: string;
  landingUrl: string;
  links: ExtractedLink[];
}): Promise<StoreDefinition> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is required for --auto-discover"
    );
  }

  const client = new OpenAI({ apiKey });

  console.log(
    `[config-generator] calling OpenAI (${options.links.length} links)...`
  );

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: buildUserPrompt(
          options.storeName,
          options.landingUrl,
          options.links
        ),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }

  // Strip markdown fences defensively
  const cleaned = content
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse OpenAI response as JSON:\n${cleaned}\n\nError: ${err}`
    );
  }

  // Force-override name and landingUrl to match CLI inputs
  parsed.name = options.storeName;
  parsed.landingUrl = options.landingUrl;

  return parsed as unknown as StoreDefinition;
}
