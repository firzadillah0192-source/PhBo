// Public contract only. No internal bucket, model, provider, prompt or credentials.
const error = { description: 'Request rejected', content: { 'application/json': { schema: { type: 'object', properties: { detail: { type: 'object', properties: { error_code: { type: 'string' }, message: { type: 'string' } } } } } } } };
const photo = { type: 'object', required: ['result_id','image_url','download_url','expires_at'], properties: {
  result_id: {type:'string'}, job_id:{type:'string'}, mode:{type:'string'}, folder_id:{type:['string','null']},
  created_at:{type:'string',format:'date-time'}, expires_at:{type:'string',format:'date-time'}, content_type:{type:'string'}, size_bytes:{type:'integer'},
  width:{type:'integer'},height:{type:'integer'},image_url:{type:'string'},download_url:{type:'string'},
} };
const read = (summary: string, scope: string, schema: object, parameters: object[] = []) => ({ summary, description:`Requires ${scope}. Bearer credentials are also required when following returned image/download URLs.`, security:[{bearerAuth:[]}], parameters,
  responses:{'200':{description:'Success',content:{'application/json':{schema}}},'401':error,'403':error,'404':error,'410':error,'422':error,'429':{...error,headers:{'Retry-After':{schema:{type:'integer'},description:'Seconds before retry'}}}} });
const binary = (summary: string) => ({...read(summary,'results:read',{}),parameters:[{name:'id',in:'path',required:true,schema:{type:'string',pattern:'^[a-f0-9]{32}$'}}],responses:{...read(summary,'results:read',{}).responses,'200':{description:'Image bytes',content:{'image/png':{schema:{type:'string',format:'binary'}},'image/jpeg':{schema:{type:'string',format:'binary'}},'image/webp':{schema:{type:'string',format:'binary'}}}}}});
export const storageOpenApi = {
  openapi:'3.1.0',info:{title:'NXBooth Storage API',version:'1.0.0',description:'Read your own folders and generated photos. Retention, deletion, ownership and payment checks apply. No upload, folder mutation or S3 credentials are exposed by Storage.'},
  servers:[{url:'/api/public/v1'}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Create a Secret Key in Account → API & Integrasi. Never place it in a URL or public browser bundle.'}}},
  paths:{
    '/storage/folders':{get:read('List owned folders','results:read',{type:'object',properties:{folders:{type:'array',items:{type:'object',properties:{id:{type:'string'},name:{type:'string'},count:{type:'integer'},created_at:{type:'string',format:'date-time'},updated_at:{type:'string',format:'date-time'}}}},default_folder_id:{type:['string','null']}}})},
    '/storage/photos':{get:read('List owned photos','results:read',{type:'object',properties:{photos:{type:'array',items:photo},next_cursor:{type:['string','null']}}},[
      {name:'folder_id',in:'query',description:'Omit for all photos; use unfiled for photos without a folder.',schema:{type:'string'}},
      {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:50,default:20}},
      {name:'cursor',in:'query',description:'Opaque next_cursor from the previous page.',schema:{type:'string'}},
    ])},
    '/storage/photos/{id}/image':{get:binary('Read an owned photo')},
    '/storage/photos/{id}/download':{get:binary('Download an owned photo')},
    '/usage':{get:read('Read this key’s daily API usage','usage:read',{type:'object',properties:{key:{type:'object',description:'Key metadata only; never the secret.'},daily:{type:'array',items:{type:'object',properties:{day:{type:'string',format:'date'},requests:{type:'integer'},generations:{type:'integer'}}}}}})},
  },
};


export const generationOpenApi = {
  ...storageOpenApi,
  info: {...storageOpenApi.info,title:'NXBooth Generation & Storage API',description:'Generate BASIC images from published templates using the Standard lane (50 AI Credit). Uses the same account wallet, storage quota and retention as the website. A failed settled job refunds its reserved credit. No custom prompts, model selection or Fast lane in this API version.'},
  paths: {
    ...storageOpenApi.paths,
    '/templates':{get:read('List available BASIC templates','catalog:read',{type:'object',properties:{templates:{type:'array',items:{type:'object',properties:{id:{type:'string'},name:{type:'string'},description:{type:'string'},credit_cost:{type:'integer',const:50},preview_url:{type:['string','null']},input:{type:'object',properties:{photos:{type:'integer',const:1},max_bytes:{type:'integer'}}}}}},count:{type:'integer'}}})},
    '/templates/{id}':{get:read('Read a BASIC template','catalog:read',{type:'object'},[{name:'id',in:'path',required:true,schema:{type:'string'}}])},
    '/inputs':{post:{summary:'Upload one source photo',description:'Requires inputs:write. Multipart file; same MIME, size, dimension and readability validation as the website. Does not charge AI Credit. Upload expires at expires_at.',security:[{bearerAuth:[]}],requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:['file'],properties:{file:{type:'string',format:'binary'}}}}}},responses:{'201':{description:'Validated input',content:{'application/json':{schema:{type:'object',properties:{input_id:{type:'string'},content_type:{type:'string'},size_bytes:{type:'integer'},width:{type:'integer'},height:{type:'integer'},created_at:{type:'string',format:'date-time'},expires_at:{type:'string',format:'date-time'}}}}}},'401':error,'403':error,'413':error,'422':error,'429':error,'503':error}}},
    '/generations':{post:{summary:'Queue a BASIC image generation',description:'Requires generations:create. Standard only, 50 AI Credit reserved from the key owner. Keep the same Idempotency-Key when retrying an identical request, including after a network timeout. A reused key with different content returns 409. folder_id omitted uses the owner default; null stores unfiled. A 202 response is queued work, not a completed image.',security:[{bearerAuth:[]}],parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:1,maxLength:120}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['template_id','input_id'],properties:{template_id:{type:'string',maxLength:128},input_id:{type:'string',maxLength:32},folder_id:{type:['string','null'],pattern:'^[a-f0-9]{32}$'}}}}}},responses:{'202':{description:'Queued or existing identical job',content:{'application/json':{schema:{type:'object',properties:{job_id:{type:'string'},state:{type:'string',enum:['QUEUED','PROCESSING','COMPLETED','FAILED']},template_id:{type:'string'},created_at:{type:'string',format:'date-time'}}}}}},'400':error,'401':error,'403':error,'404':error,'409':error,'422':error,'429':error,'503':error}}},
    '/generations/{id}':{get:{...read('Read real generation state','generations:read',{type:'object',properties:{job_id:{type:'string'},state:{type:'string',enum:['QUEUED','PROCESSING','COMPLETED','FAILED']},result_id:{type:['string','null']},error_code:{type:['string','null']},credit_charge:{type:['object','null'],properties:{status:{type:'string'},credits:{type:'integer'}}}}},[{name:'id',in:'path',required:true,schema:{type:'string'}}]),description:'Requires generations:read. Poll after Retry-After (3 seconds while queued/processing). On COMPLETED use result_id with Storage API. FAILED carries a safe error_code; never treat a queued/failed job as success.'}},
  },
};
