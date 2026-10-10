"""Read-only standard API price comparisons, never an upstream invoice."""

from decimal import Decimal


SOURCE = "https://developers.openai.com/api/docs/guides/image-generation"
RATES = {
    "gpt-image-2.5": (5, 8, 30),
}


def estimate_image_price(run) -> dict:
    model = (run.provider_reported_model or run.requested_model or run.provider_model or "").split("/")[-1]
    key = next((key for key in RATES if model == key or model.startswith(key + "-")), None)
    result = {"status": "unavailable", "currency": "USD", "rate_model": key,
              "source_url": SOURCE, "rates_checked_on": "2026-10-02",
              "text_input_per_million": None, "image_input_per_million": None,
              "image_output_per_million": None, "low_usd": None, "high_usd": None,
              "note": "No supported GPT Image pricing reference for this model."}
    if key is None:
        return result
    text_rate, image_rate, output_rate = map(lambda v: Decimal(str(v)), RATES[key])
    result.update(text_input_per_million=float(text_rate), image_input_per_million=float(image_rate),
                  image_output_per_million=float(output_rate))
    if all(getattr(run, field) is not None for field in ("input_text_tokens", "input_image_tokens", "output_image_tokens")):
        value = (run.input_text_tokens * text_rate + run.input_image_tokens * image_rate
                 + run.output_image_tokens * output_rate) / Decimal(1_000_000)
        result.update(status="image_token_estimate", low_usd=float(value), high_usd=float(value),
                      note="Standard uncached API estimate for reported text/image tokens only; excludes other model calls, retries, discounts and gateway charges.")
    elif run.input_tokens is not None and run.output_tokens is not None:
        low = (run.input_tokens * text_rate + run.output_tokens * output_rate) / Decimal(1_000_000)
        high = (run.input_tokens * image_rate + run.output_tokens * output_rate) / Decimal(1_000_000)
        result.update(status="simulation", low_usd=float(low), high_usd=float(high),
                      note="Simulation only: assumes every reported output token is an image token. Low assumes all input is text; high assumes all input is image. Actual image usage may be missing; this is not a bound on your bill. Standard uncached rates; excludes retries and gateway charges.")
    else:
        result["note"] = "Token usage unavailable; no cost can be calculated."
    if key == "gpt-image-2.5":
        result["note"] += " Uses official GPT Image 2.5 Sunburst/Flare rates as a reference for the gateway model alias."
    return result
