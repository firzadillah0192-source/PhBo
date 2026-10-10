# Admin image token calculation

Admin → Generations lists input/output/total tokens and a rupiah cost comparison.
Click a job to see the formula, assumptions, and reference rates. Provider Ops
also shows the comparison for recent jobs. The editable exchange rate starts
at Rp17,500 per USD as a planning assumption, not a live rate; it resets on reload.

GET `/api/admin/usage/generations` and the existing user generation lists add
`input_tokens`, `output_tokens`, and `api_price_estimate` to each item.
GET `/api/admin/usage/generations/{job_id}` adds the same estimate to each
provider run and its generation item. Existing admin authorization applies.
No database migration, customer API change, or new paid generation is needed.

`api_price_estimate` contains `status`, `currency` (USD for internal conversion),
`rate_model`, `source_url`, `rates_checked_on`, three rates per million tokens,
`low_usd`, `high_usd`, and `note`. Frontend amounts and reference rates use IDR.

Rates checked 2026-10-02: GPT Image 2.5 text input $5, image input $8,
image output $30 per million tokens, standard uncached processing.
Source: https://developers.openai.com/api/docs/guides/image-generation
The gateway alias `gpt-image-2.5` uses Sunburst/Flare rates as a comparison;
it does not establish the upstream account's billing arrangement.

With a reported modality breakdown, `image_token_estimate` calculates:
`(text_input*5 + image_input*8 + image_output*30) / 1,000,000`.
With only input/output totals, `simulation` assumes all output is image tokens;
the two scenarios price all input as text or all input as image respectively.
These scenarios are not bounds on the actual bill: image tool usage may be
missing from gateway totals. Other model calls, failed attempts, retries,
gateway charges, caching, discounts, and subscription costs are excluded.
Missing usage or an unsupported reported model returns `unavailable` with
null amounts, never a fabricated zero. Historical metadata is evaluated on read.
