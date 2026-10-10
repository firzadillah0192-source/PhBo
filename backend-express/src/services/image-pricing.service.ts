import type { NxProviderRun } from '@prisma/client';
// Preserve the existing application's dated comparison, never an invoice or
// a newly fetched billing rate. Missing usage remains unavailable.
export function estimateImagePrice(run:NxProviderRun){
  const model=(run.provider_reported_model||run.requested_model||run.provider_model||'').split('/').at(-1)!;
  const key=model==='gpt-image-2.5'||model.startsWith('gpt-image-2.5-')?'gpt-image-2.5':null;
  const result={status:'unavailable',currency:'USD',rate_model:key,source_url:'https://developers.openai.com/api/docs/guides/image-generation',rates_checked_on:'2026-10-02',text_input_per_million:null as number|null,image_input_per_million:null as number|null,image_output_per_million:null as number|null,low_usd:null as number|null,high_usd:null as number|null,note:'No supported GPT Image pricing reference for this model.'};
  if(!key)return result;Object.assign(result,{text_input_per_million:5,image_input_per_million:8,image_output_per_million:30});
  if(run.input_text_tokens!==null&&run.input_image_tokens!==null&&run.output_image_tokens!==null){
    let usage:Record<string,unknown>={};try{usage=JSON.parse(run.provider_usage_raw_json||'{}')??{};}catch{}
    let textCache=usage.cached_text_tokens??0,imageCache=usage.cached_image_tokens??0;
    if(usage.cached_tokens!==undefined&&(usage.cached_text_tokens===undefined||usage.cached_image_tokens===undefined)){
      const cache=usage.cached_tokens;
      if(typeof cache!=='number'||!Number.isSafeInteger(cache)||cache<0||cache>run.input_text_tokens+run.input_image_tokens){result.note='Invalid reported cached token count.';return result;}
      // With known input categories but unknown cache categories, allocating
      // cache to text first gives the upper estimated cost (smaller discount).
      textCache=Math.min(cache,run.input_text_tokens);imageCache=cache-Math.min(cache,run.input_text_tokens);
    }
    if(typeof textCache!=='number'||typeof imageCache!=='number'||!Number.isSafeInteger(textCache)||!Number.isSafeInteger(imageCache)||textCache<0||imageCache<0||textCache>run.input_text_tokens||imageCache>run.input_image_tokens){result.note='Invalid reported cached token count.';return result;}
    const cost=((run.input_text_tokens-textCache)*5+textCache*1.25+(run.input_image_tokens-imageCache)*8+imageCache*2+run.output_image_tokens*30)/1000000;
    Object.assign(result,{status:'image_token_estimate',low_usd:cost,high_usd:cost,note:'API estimate for reported categories, with reported cache subtracted from input before discount. Unknown cache categories use the upper allocation. Excludes failed attempts and gateway charges.'});}
  else if(run.input_tokens!==null&&run.output_tokens!==null){
    let usage:Record<string,unknown>={};try{usage=JSON.parse(run.provider_usage_raw_json||'{}')??{};}catch{}
    const cache=usage.cached_tokens??(typeof usage.cached_text_tokens==='number'&&typeof usage.cached_image_tokens==='number'?usage.cached_text_tokens+usage.cached_image_tokens:0);
    if(typeof cache!=='number'||!Number.isSafeInteger(cache)||cache<0||cache>run.input_tokens){result.note='Invalid reported cached token count.';return result;}
    Object.assign(result,{status:'simulation',low_usd:((run.input_tokens-cache)*5+cache*1.25+run.output_tokens*30)/1000000,high_usd:((run.input_tokens-cache)*8+cache*2+run.output_tokens*30)/1000000,note:'Simulation: output treated as image tokens. Low treats input/cache as text; high treats input/cache as image. Cache is subtracted from input before its discounted rate. Missing cache receives no discount. Excludes failed attempts and gateway charges; not the provider invoice.'});}
  else result.note='Token usage unavailable; no cost can be calculated.';
  result.note+=' Uses official GPT Image 2.5 Sunburst/Flare rates as a reference for the gateway model alias.';return result;
}
