import type { NxProviderRun } from '@prisma/client';
// Preserve the existing application's dated comparison, never an invoice or
// a newly fetched billing rate. Missing usage remains unavailable.
export function estimateImagePrice(run:NxProviderRun){
  const model=(run.provider_reported_model||run.requested_model||run.provider_model||'').split('/').at(-1)!;
  const key=model==='gpt-image-2.5'||model.startsWith('gpt-image-2.5-')?'gpt-image-2.5':null;
  const result={status:'unavailable',currency:'USD',rate_model:key,source_url:'https://developers.openai.com/api/docs/guides/image-generation',rates_checked_on:'2026-10-02',text_input_per_million:null as number|null,image_input_per_million:null as number|null,image_output_per_million:null as number|null,low_usd:null as number|null,high_usd:null as number|null,note:'No supported GPT Image pricing reference for this model.'};
  if(!key)return result;Object.assign(result,{text_input_per_million:5,image_input_per_million:8,image_output_per_million:30});
  if(run.input_text_tokens!==null&&run.input_image_tokens!==null&&run.output_image_tokens!==null){const cost=(run.input_text_tokens*5+run.input_image_tokens*8+run.output_image_tokens*30)/1000000;Object.assign(result,{status:'image_token_estimate',low_usd:cost,high_usd:cost,note:'Standard uncached API estimate for reported text/image tokens only; excludes other model calls, retries, discounts and gateway charges.'});}
  else if(run.input_tokens!==null&&run.output_tokens!==null){Object.assign(result,{status:'simulation',low_usd:(run.input_tokens*5+run.output_tokens*30)/1000000,high_usd:(run.input_tokens*8+run.output_tokens*30)/1000000,note:'Simulation only: assumes every reported output token is an image token. Low assumes all input is text; high assumes all input is image. Actual image usage may be missing; this is not a bound on your bill. Standard uncached rates; excludes retries and gateway charges.'});}
  else result.note='Token usage unavailable; no cost can be calculated.';
  result.note+=' Uses official GPT Image 2.5 Sunburst/Flare rates as a reference for the gateway model alias.';return result;
}
