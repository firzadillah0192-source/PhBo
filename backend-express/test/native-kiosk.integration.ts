import assert from 'node:assert/strict';
import type pg from 'pg';
import type { PrismaClient } from '@prisma/client';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { NativeKioskModel } from '../src/models/native-kiosk.model.js';
import { NativeKioskService } from '../src/services/native-kiosk.service.js';
import { CustomerUploadModel } from '../src/models/customer-upload.model.js';
import { CustomerUploadService } from '../src/services/customer-upload.service.js';
import { CustomerGenerationModel } from '../src/models/customer-generation.model.js';
import { CustomerGenerationService } from '../src/services/customer-generation.service.js';
import { CustomerResultModel } from '../src/models/customer-result.model.js';
import { CustomerResultService } from '../src/services/customer-result.service.js';
import { createMigrationApp } from '../src/migration-app.js';
import { legacyId } from '../src/services/customer-credentials.service.js';
import { createHash } from 'node:crypto';

export async function nativeKioskIntegration(sql: pg.Client, db: PrismaClient) {
  const root = await mkdtemp(join(tmpdir(),'nxbooth-kiosk-integration-'));
  try {
    await sql.query(`
      ALTER TABLE guest_sessions ADD COLUMN created_at timestamptz DEFAULT now();
      ALTER TABLE generation_jobs ADD COLUMN event_id varchar(32),ADD COLUMN kiosk_session_id varchar(64);
      CREATE TABLE events(id varchar(32) PRIMARY KEY,slug varchar(128) UNIQUE,status varchar(16),starts_at timestamptz,ends_at timestamptz,classic_enabled boolean,basic_enabled boolean,advanced_enabled boolean,classic_layout_id varchar(32));
      CREATE TABLE kiosk_sessions(id varchar(64) PRIMARY KEY,event_id varchar(32) NOT NULL REFERENCES events(id),status varchar(16) DEFAULT 'ACTIVE',mode varchar(16),created_at timestamptz DEFAULT now(),last_activity_at timestamptz DEFAULT now(),closed_at timestamptz);
      CREATE TABLE uploads(id varchar(32) PRIMARY KEY,account_id varchar(32),guest_id varchar(64),kiosk_session_id varchar(64) REFERENCES kiosk_sessions(id),created_at timestamptz DEFAULT now(),storage_path varchar(512),filename varchar(255),content_type varchar(64),size_bytes integer,width integer,height integer,format varchar(16),sha256 varchar(64),validation_status varchar(16),validation_detail text);
      CREATE TABLE admin_templates(id varchar(128) PRIMARY KEY,name varchar(255),description text,image_path varchar(512),marketing_preview_path varchar(512),metadata_path varchar(512),enabled boolean,sort_order integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),updated_by varchar(128) DEFAULT 'test');
      CREATE TABLE admin_experiences(id varchar(128) PRIMARY KEY,name varchar(255),description text,category varchar(64),thumbnail_path varchar(512),status varchar(16),enabled boolean,sort_order integer,compatible_frame_style_ids_json text,compatible_ornament_ids_json text,max_ornaments integer,internal_prompt text,provider varchar(64),model varchar(128),reference_mode varchar(64),output_format varchar(16),preview_status varchar(16),preview_error text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),updated_by varchar(128) DEFAULT 'test');
      CREATE TABLE advanced_frame_styles(id varchar(128) PRIMARY KEY,slug varchar(128),name varchar(255),description text,prompt_fragment text,enabled boolean,sort_order integer);
      CREATE TABLE advanced_ornaments(id varchar(128) PRIMARY KEY,slug varchar(128),name varchar(255),description text,prompt_fragment text,enabled boolean,sort_order integer);
      CREATE TABLE classic_layouts(id varchar(32) PRIMARY KEY,slug varchar(128),name varchar(255),canvas_width integer,canvas_height integer,shot_count integer,layout_config_json text,frame_asset_path varchar(512),active boolean,sort_order integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE results(id varchar(32) PRIMARY KEY,deleted_at timestamptz,created_at timestamptz DEFAULT now(),job_id varchar(32) UNIQUE,template_id varchar(128),storage_path varchar(512),content_type varchar(64),size_bytes integer,width integer,height integer,sha256 varchar(64),provider varchar(64),model varchar(128));
      CREATE TABLE result_claims(id varchar(32) PRIMARY KEY,result_id varchar(32),token_hash varchar(64) UNIQUE,created_at timestamptz DEFAULT now(),expires_at timestamptz,first_accessed_at timestamptz,last_accessed_at timestamptz,download_count integer DEFAULT 0,is_revoked boolean DEFAULT false,created_by_session_id varchar(128),created_by_kiosk_session_id varchar(128),metadata_json text);
      CREATE TABLE event_basic_templates(event_id varchar(32),template_id varchar(128),enabled boolean);
      CREATE TABLE event_advanced_experiences(event_id varchar(32),experience_id varchar(128),enabled boolean);
      INSERT INTO admin_templates(id,name,description,image_path,enabled) VALUES ('template','Fixture','Synthetic only','fixture',true);
      INSERT INTO admin_experiences(id,name,status,enabled,max_ornaments,internal_prompt,provider,model) VALUES
        ('world','Fixture','published',true,3,'Keep the fixture experience primary.','9router','test-model'),
        ('mini-me','Basic model preset','published',true,0,'Preserve identity in the scene.','9router','test-basic-model');
      INSERT INTO advanced_frame_styles(id,enabled,prompt_fragment) VALUES ('natural',true,'Integrate a natural frame style.');
      INSERT INTO classic_layouts(id,slug,name,canvas_width,canvas_height,active,shot_count,layout_config_json,frame_asset_path)
        VALUES ('reviewed','reviewed-fixture','Reviewed fixture',1200,3600,true,3,'{"slots":[]}','fixture-frame.png');
    `);
    for (const file of ['015_native_worker_leases.sql','017_native_kiosk_photo_claims.sql','017_native_kiosk_photo_claims.sql'])
      await sql.query(await readFile(new URL(`../../backend/migrations/${file}`,import.meta.url),'utf8'));
    for (let i=0;i<2;i++) await sql.query(await readFile(new URL('../migrations/001_kiosk_transfer_requests.sql',import.meta.url),'utf8'));
    const image = await sharp({ create: { width: 320,height: 480,channels: 3,background: 'purple' } }).jpeg().toBuffer();
    const uploads = new CustomerUploadService(new CustomerUploadModel(db),{ normalize: async () => ({ bytes: image,width: 320,height: 480 }) } as never,
      { uploadsDir: join(root,'uploads'),retentionHours: 24 });
    let enqueued = 0;
    const generationModel = new CustomerGenerationModel(db);
    const generation = new CustomerGenerationService(generationModel,uploads,
      { file: async () => 'fixture',validateLayout: async () => ({ slots: [] }),
        freezeBasicTemplate: async () => ({ asset: 'fixture',sha256: 'a'.repeat(64),width: 1024,height: 1536 }),
        freezeLayout: async (row: { id: string; slug: string; name: string; shot_count: number; layout_config_json: string }) => ({
          ...row,active: true,canvas_width: 1200,canvas_height: 3600,frame_asset_path: 'fixture-frame.png',
        }) } as never,{ enqueue: async () => { enqueued++; } });
    const results = new CustomerResultService(new CustomerResultModel(db),{ resultsDir: join(root,'results'),claimHours: 24,publicOrigin: 'https://nxbooth.gennexbyte.com',production: true });
    const kioskModel = new NativeKioskModel(db), kiosk = new NativeKioskService(kioskModel,uploads,generation,results,
      { apiKey: 'test-key-'.repeat(8),ttlSeconds: 86400,generationLimit: 3,secureCookie: true });
    const app = createMigrationApp({} as never,{ corsOrigins: ['https://nxbooth.gennexbyte.com'],trustProxy: true,kiosk,health: async()=>{await sql.query('SELECT 1');return {status:'ok',checks:{database:'ok'},queue_backend:'postgres'};} });
    const grant = (await import('../src/lib/tokens.js')).token();
    const reserveBody = { claimToken: grant };
    const reservations = await Promise.all(Array.from({ length: 6 },() => request(app).post('/api/v1/kiosk/sessions')
      .set('X-API-Key','test-key-'.repeat(8)).set('Idempotency-Key','reserve-once').send(reserveBody)));
    reservations.forEach(r => assert.equal(r.status,201,JSON.stringify(r.body)));
    assert.equal(new Set(reservations.map(r => r.body.data.id)).size,1);
    const reserved = reservations[0].body.data;
    assert.equal(reserved.status,'UPLOADING');
    const reservedRow = await kioskModel.find(reserved.code); assert.ok(reservedRow);
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM credit_ledger WHERE guest_id=$1',[reservedRow.guest_id])).rows[0].n,1);
    await request(app).post('/api/v1/kiosk/sessions').set('X-API-Key','test-key-'.repeat(8)).set('Idempotency-Key','reserve-once')
      .send({ claimToken: (await import('../src/lib/tokens.js')).token() }).expect(409);
    await request(app).post(`/api/v1/photo-sessions/${reserved.code}/claim`).send({ token: grant }).expect(404);
    const transfer = (secret=grant, bytes=image, key='upload-once') => request(app).post(reserved.uploadPath)
      .set('X-API-Key','test-key-'.repeat(8)).set('X-Kiosk-Upload-Token',secret).set('Idempotency-Key',key)
      .attach('image',bytes,{ filename: 'transfer.jpg',contentType: 'image/jpeg' });
    await transfer((await import('../src/lib/tokens.js')).token()).expect(403);
    await request(app).post(reserved.uploadPath).set('X-Kiosk-Upload-Token',grant).attach('image',image,'transfer.jpg').expect(401);
    const mediaRetries = await Promise.all(Array.from({ length: 6 },()=>transfer()));
    mediaRetries.forEach(r=>assert.equal(r.status,200,JSON.stringify(r.body)));
    assert.equal(new Set(mediaRetries.map(r=>r.body.data.photos[0].id)).size,1);
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM uploads WHERE kiosk_session_id=$1',[reserved.id])).rows[0].n,1);
    await transfer(grant,Buffer.concat([image,Buffer.from('different')])).expect(409);
    await transfer(grant,image,'different-upload').expect(409);
    // Replay after restarting the service: durable database state, no memory cache.
    const restarted = new NativeKioskService(new NativeKioskModel(db),uploads,generation,results,kiosk.config);
    assert.equal((await restarted.reserve(reserveBody,'reserve-once')).id,reserved.id);
    assert.equal((await restarted.transfer(reserved.code,grant,[{buffer:image,mimetype:'image/jpeg',originalname:'transfer.jpg'} as Express.Multer.File],{},'upload-once')).photos[0].id,mediaRetries[0].body.data.photos[0].id);
    const transferClaim = await request(app).post(`/api/v1/photo-sessions/${reserved.code}/claim`).send({token:grant}).expect(200);
    const transferCookie = (transferClaim.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    await request(app).get(`/api/v1/photos/${mediaRetries[0].body.data.photos[0].id}`).set('Cookie',transferCookie).expect(200);
    // Simulated I/O crash rolls back publication and keeps the reservation usable.
    const crashGrant = (await import('../src/lib/tokens.js')).token();
    const crash = await kiosk.reserve({claimToken:crashGrant},'crash-reserve');
    await assert.rejects(kioskModel.uploadOnce(crash.code,(await import('../src/lib/tokens.js')).hash(crashGrant),'crash-upload','a'.repeat(64),async()=>{throw new Error('Injected I/O crash');}));
    assert.equal((await kioskModel.find(crash.code))!.status,'UPLOADING');
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM kiosk_transfer_requests WHERE session_id=$1 AND kind=\'UPLOAD\'',[crash.id])).rows[0].n,0);
    await request(app).post(crash.uploadPath).set('X-API-Key','test-key-'.repeat(8)).set('X-Kiosk-Upload-Token',crashGrant)
      .set('Idempotency-Key','crash-upload').attach('image',image,{filename:'crash.jpg',contentType:'image/jpeg'}).expect(200);
    const crashCookie = (await request(app).post(`/api/v1/photo-sessions/${crash.code}/claim`).send({token:crashGrant}).expect(200)).headers['set-cookie'] as unknown as string[];
    await request(app).get(`/api/v1/photos/${mediaRetries[0].body.data.photos[0].id}`).set('Cookie',crashCookie[0].split(';')[0]).expect(404);
    await sql.query("UPDATE kiosk_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[reserved.id]);
    await transfer().expect(410);
    if (process.env.PHBO_CONTROL_TEST_URL && process.env.PHBO_MEDIA_TEST_URL) {
      const server = app.listen(8081,'0.0.0.0');
      await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
      try {
        const control = process.env.PHBO_CONTROL_TEST_URL, media = process.env.PHBO_MEDIA_TEST_URL;
        const headers = { 'Content-Type':'application/json','X-API-Key':kiosk.config.apiKey,'Idempotency-Key':'gateway-reservation' };
        const gatewayGrant = (await import('../src/lib/tokens.js')).token();
        const gatewayHealth = await fetch(`${control}/api/health`); assert.equal(gatewayHealth.status,200);
        assert.equal((await gatewayHealth.json() as {status:string}).status,'ok');
        const gatewayReservation = await fetch(`${control}/api/v1/kiosk/sessions`,{method:'POST',headers,body:JSON.stringify({claimToken:gatewayGrant})});
        assert.equal(gatewayReservation.status,201);
        assert.match(gatewayReservation.headers.get('x-request-id')!,/^[a-f0-9]{32}$/);
        const reservedHttp = (await gatewayReservation.json() as {data:{id:string;code:string;uploadPath:string}}).data;
        // Multipart upload and legacy combined uploads must never reach control upstream.
        assert.equal((await fetch(`${control}${reservedHttp.uploadPath}`,{method:'POST',headers})).status,404);
        assert.equal((await fetch(`${control}/api/v1/photo-sessions`,{method:'POST',headers})).status,404);
        assert.equal((await fetch(`${control}/api/v1/kiosk/sessions`,{method:'POST',headers:{...headers,'Content-Type':'image/jpeg'},body:new Uint8Array(image)})).status,415);
        assert.equal((await fetch(`${control}/api/v1/kiosk/sessions`,{method:'POST',headers,body:JSON.stringify({padding:'x'.repeat(40000)})})).status,413);
        const makeForm = () => { const form=new FormData();form.append('image',new Blob([new Uint8Array(image)],{type:'image/jpeg'}),'gateway.jpg');return form; };
        const sendMedia = () => fetch(`${media}${reservedHttp.uploadPath}`,{method:'POST',headers:{'X-API-Key':kiosk.config.apiKey,'X-Kiosk-Upload-Token':gatewayGrant,'Idempotency-Key':'gateway-upload'},body:makeForm()});
        const firstMedia=await sendMedia(); assert.equal(firstMedia.status,200,await firstMedia.clone().text());
        const firstInfo=(await firstMedia.json() as {data:{photos:{id:string}[]}}).data;
        assert.equal((await sendMedia()).status,200);
        const gatewayClaim=await fetch(`${control}/api/v1/photo-sessions/${reservedHttp.code}/claim`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:gatewayGrant})});
        assert.equal(gatewayClaim.status,200);
        const gatewayCookie=gatewayClaim.headers.get('set-cookie')!.split(';')[0];
        const imagePath=`/api/v1/photos/${firstInfo.photos[0].id}`;
        assert.equal((await fetch(`${control}${imagePath}`)).status,404);
        assert.equal((await fetch(`${media}${imagePath}`)).status,401);
        const downloaded=await fetch(`${media}${imagePath}`,{headers:{Cookie:gatewayCookie}});
        assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),image);
        assert.equal((await fetch(`${media}/api/v1/kiosk/sessions`,{method:'POST',headers,body:'{}'})).status,404);
        assert.equal((await fetch(`${control}/api/v1/results/${'a'.repeat(32)}/download`)).status,404);
        const jobResponse=await fetch(`${control}/api/v1/generations`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:gatewayCookie,'Idempotency-Key':'gateway-job'},body:JSON.stringify({sessionCode:reservedHttp.code,mode:'BASIC',templateId:'template'})});
        assert.equal(jobResponse.status,202,await jobResponse.clone().text());
        const gatewayJob=(await jobResponse.json() as {data:{id:string}}).data;
        assert.equal((await fetch(`${control}/api/v1/generations/${gatewayJob.id}`,{headers:{Cookie:gatewayCookie}})).status,200);
        // Hold a real multipart transfer open while probing the control process.
        const slowGrant=(await import('../src/lib/tokens.js')).token();
        const slowReservation=await kiosk.reserve({claimToken:slowGrant},'slow-reserve');
        const boundary='photobooth-test-boundary';
        const partHeader=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="slow.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
        let release!:()=>void;
        const held=new Promise<void>(resolve=>{release=resolve;});
        let started!:()=>void;
        const sentHeader=new Promise<void>(resolve=>{started=resolve;});
        const stream=new ReadableStream<Uint8Array>({async start(controller){controller.enqueue(partHeader);started();await held;controller.enqueue(new Uint8Array(image));controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));controller.close();}});
        const slowUpload=fetch(`${media}${slowReservation.uploadPath}`,{method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'X-API-Key':kiosk.config.apiKey,'X-Kiosk-Upload-Token':slowGrant,'Idempotency-Key':'slow-upload'},body:stream,duplex:'half'} as RequestInit);
        try {
          await sentHeader;
          assert.equal((await fetch(`${control}/api/health`,{signal:AbortSignal.timeout(5000)})).status,200);
        } finally {release();}
        const slowFinished=await slowUpload;assert.equal(slowFinished.status,200,await slowFinished.clone().text());
        console.log('PASS: actual NGINX control/media isolation, session+upload+claim+download, auth, limits and request IDs');
      } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
    }
    const enqueuedBeforeLegacy = enqueued;
    const webBefore = (await sql.query("SELECT ai_quota_used,ai_quota_reserved FROM guest_sessions WHERE id='first'")).rows[0];
    let uploadRequest = request(app).post('/api/v1/photo-sessions').set('X-API-Key','test-key-'.repeat(8));
    for (let i = 0; i < 4; i++) uploadRequest = uploadRequest.attach('image',image,{ filename: `synthetic-${i}.jpg`,contentType: 'image/jpeg' });
    const created = (await uploadRequest.expect(201)).body.data;
    assert.equal(created.photos.length,4); assert.equal(created.generationLimit,3);
    assert.equal(created.qrUrl,new URL(`/claim/${created.code}#token=${created.claimToken}`,'https://nxbooth.gennexbyte.com').toString());
    const raw = await kioskModel.find(created.code); assert.ok(raw);
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM uploads WHERE kiosk_session_id=$1',[raw.id])).rows[0].n,4);
    assert.ok(!JSON.stringify(created).includes(raw.claim_token_hash));
    const raced = await Promise.all(Array.from({ length: 8 },() => request(app).post(`/api/v1/photo-sessions/${created.code}/claim`).send({ token: created.claimToken })));
    assert.equal(raced.filter(r => r.status === 200).length,1); assert.equal(raced.filter(r => r.status === 409).length,7);
    const cookie = (raced.find(r => r.status === 200)!.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const body = { sessionCode: created.code,mode: 'BASIC',templateId: 'template' };
    const retries = await Promise.all(Array.from({ length: 8 },() => request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','one').send(body)));
    retries.forEach(r => assert.equal(r.status,202,JSON.stringify(r.body)));
    const basicId = retries[0].body.data.id;
    assert.equal(new Set(retries.map(r => r.body.data.id)).size,1); assert.equal(enqueued,enqueuedBeforeLegacy+1);
    const basicSnapshot=JSON.parse((await db.nxGenerationJob.findUniqueOrThrow({where:{id:basicId}})).engine_config_json!);
    assert.equal(basicSnapshot.mode,'BASIC');assert.equal(basicSnapshot.model,'test-basic-model');assert.match(basicSnapshot.prompt,/Fixture/);
    assert.ok(!JSON.stringify(retries[0].body).includes(basicSnapshot.prompt));
    assert.equal((await db.nxGuestSession.findUniqueOrThrow({ where: { id: raw.guest_id } })).ai_quota_reserved,1);
    assert.equal((await sql.query('SELECT kiosk_session_id FROM generation_jobs WHERE id=$1',[basicId])).rows[0].kiosk_session_id,raw.id);
    await request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','one').send({ ...body,templateId: 'different' }).expect(409);
    const advanced = (await request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','two').send({ sessionCode: created.code,mode: 'ADVANCED',experienceId: 'world' }).expect(202)).body.data;
    const advancedSnapshot=JSON.parse((await db.nxGenerationJob.findUniqueOrThrow({where:{id:advanced.id}})).engine_config_json!);
    assert.equal(advancedSnapshot.mode,'ADVANCED');assert.equal(advancedSnapshot.model,'test-model');
    assert.match(advancedSnapshot.prompt,/Keep the fixture experience primary/);assert.match(advancedSnapshot.prompt,/Integrate a natural frame style/);
    await request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','three').send(body).expect(202);
    await request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','four').send(body).expect(403);
    await generationModel.queueFailed(advanced.id);
    await request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','after-refund').send(body).expect(202);
    const classicBody = { sessionCode: created.code,mode: 'CLASSIC',frameId: 'reviewed',photoIds: created.photos.slice(0,3).map((p: { id: string }) => p.id) };
    await request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','bad-count').send({ ...classicBody,photoIds: classicBody.photoIds.slice(0,2) }).expect(422);
    const classic = (await request(app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','classic').send(classicBody).expect(202)).body.data;
    const classicSnapshot=JSON.parse((await db.nxGenerationJob.findUniqueOrThrow({where:{id:classic.id}})).engine_config_json!);
    assert.equal(classicSnapshot.mode,'CLASSIC');assert.equal(classicSnapshot.layout.shot_count,3);
    assert.equal(classicSnapshot.layout.canvas_width,1200);assert.equal(classicSnapshot.layout.canvas_height,3600);
    assert.equal(await db.nxQuotaReservation.count({ where: { job_id: classic.id } }),0);
    assert.equal((await db.nxGuestSession.findUniqueOrThrow({ where: { id: raw.guest_id } })).ai_quota_reserved,3);
    const lease = legacyId(); await generationModel.claim(classic.id,lease);
    // Synthetic Result fixture validates model/claim reuse, not image quality or a provider.
    const resultId = legacyId();
    const resultBytes = await sharp({ create: { width: 1200,height: 3600,channels: 3,background: 'purple' } }).png().toBuffer();
    const resultFolder = join(root,'results',resultId.slice(0,2)),resultPath = join(resultFolder,`${resultId}.png`);
    await mkdir(resultFolder,{ recursive: true }); await writeFile(resultPath,resultBytes);
    await generationModel.complete(classic.id,{ id: resultId,job_id: classic.id,template_id: '',storage_path: resultPath,content_type: 'image/png',size_bytes: resultBytes.length,width: 1200,height: 3600,sha256: createHash('sha256').update(resultBytes).digest('hex') },lease);
    const imageDownload = await request(app).get(`/api/v1/results/${resultId}/download`).set('Cookie',cookie).expect(200);
    assert.deepEqual(imageDownload.body,resultBytes);
    const printDownload = await request(app).get(`/api/v1/results/${resultId}/download?rendition=print`).set('Cookie',cookie).expect(200);
    const printInfo = await sharp(printDownload.body).metadata();
    assert.deepEqual([printInfo.width,printInfo.height,printInfo.density],[600,1800,300]);
    const resultClaim = (await request(app).post(`/api/v1/results/${resultId}/claim`).set('Cookie',cookie).send({}).expect(200)).body.data;
    assert.match(resultClaim.claim_url,/\/r\//);
    const resultToken = resultClaim.claim_url.split('/r/')[1];
    assert.equal((await results.publicClaim(resultToken)).result.id,resultId);
    assert.equal(await db.nxResultClaim.count({ where: { result_id: resultId } }),1);
    assert.equal((await request(app).get(`/api/v1/generations/${classic.id}`).set('Cookie',cookie).expect(200)).body.data.status,'COMPLETED');
    const history = await request(app).get(`/api/v1/photo-sessions/${created.code}/generations`).set('Cookie',cookie).expect(200);
    assert.ok(history.body.data.some((job: { id: string }) => job.id === classic.id));
    assert.deepEqual((await sql.query("SELECT ai_quota_used,ai_quota_reserved FROM guest_sessions WHERE id='first'")).rows[0],webBefore);
    const eventId = legacyId();
    await sql.query("INSERT INTO events(id,slug,status,classic_enabled,basic_enabled,advanced_enabled) VALUES ($1,'fixture-event','published',false,true,false)",[eventId]);
    await sql.query("INSERT INTO event_basic_templates(event_id,template_id,enabled) VALUES ($1,'template',true)",[eventId]);
    await sql.query("INSERT INTO admin_templates(id,name,description,image_path,enabled) VALUES ('outside-event','Outside event','Synthetic test template','fixture',true)");
    const eventSession = (await request(app).post('/api/v1/photo-sessions').set('X-API-Key','test-key-'.repeat(8))
      .field('event','fixture-event').attach('image',image,{ filename: 'synthetic-event.jpg',contentType: 'image/jpeg' }).expect(201)).body.data;
    assert.deepEqual(eventSession.availableModes,['BASIC']); assert.deepEqual(eventSession.allowedTemplateIds,['template']);
    const eventClaim = await request(app).post(`/api/v1/photo-sessions/${eventSession.code}/claim`).send({ token: eventSession.claimToken }).expect(200);
    const eventCookie = (eventClaim.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    await request(app).post('/api/v1/generations').set('Cookie',eventCookie).set('Idempotency-Key','blocked-mode')
      .send({ sessionCode: eventSession.code,mode: 'ADVANCED',experienceId: 'world' }).expect(403);
    await assert.rejects(kiosk.generate({ sessionCode: eventSession.code,mode: 'BASIC',templateId: 'outside-event' },eventCookie.split('=')[1],'blocked-template'),
      error => error instanceof Error && 'status' in error && error.status===403);
    await request(app).post('/api/v1/generations').set('Cookie',eventCookie).set('Idempotency-Key','blocked-template')
      .send({ sessionCode: eventSession.code,mode: 'BASIC',templateId: 'outside-event' }).expect(403);
    const eventJob = (await request(app).post('/api/v1/generations').set('Cookie',eventCookie).set('Idempotency-Key','allowed')
      .send({ sessionCode: eventSession.code,mode: 'BASIC',templateId: 'template' }).expect(202)).body.data;
    assert.equal((await sql.query('SELECT event_id FROM generation_jobs WHERE id=$1',[eventJob.id])).rows[0].event_id,eventId);
    await sql.query("UPDATE events SET ends_at=now()-interval '1 second' WHERE id=$1",[eventId]);
    await request(app).post('/api/v1/photo-sessions').set('X-API-Key','test-key-'.repeat(8)).field('event','fixture-event')
      .attach('image',image,{ filename: 'synthetic-event.jpg',contentType: 'image/jpeg' }).expect(404);
    await sql.query('UPDATE kiosk_sessions SET expires_at=now()-interval \'1 second\' WHERE id=$1',[raw.id]);
    await request(app).get(`/api/v1/photo-sessions/${created.code}`).set('Cookie',cookie).expect(410);
    // Also validate the actual production prerequisite state: no prior Kiosk
    // tables/columns. The migration creates the existing contracts without seeds.
    await sql.query('DROP TABLE event_basic_templates,event_advanced_experiences,kiosk_sessions,events CASCADE');
    await sql.query('ALTER TABLE uploads DROP COLUMN kiosk_session_id; ALTER TABLE generation_jobs DROP COLUMN kiosk_session_id,DROP COLUMN event_id');
    for (let i=0;i<2;i++) await sql.query(await readFile(new URL('../../backend/migrations/017_native_kiosk_photo_claims.sql',import.meta.url),'utf8'));
    assert.equal((await sql.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='kiosk_sessions' AND column_name='event_id'")).rows[0].is_nullable,'YES');
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM classic_layouts')).rows[0].n,1);
  } finally {
    await sql.query('DROP TABLE IF EXISTS kiosk_transfer_requests,event_basic_templates,event_advanced_experiences,results,result_claims,admin_templates,admin_experiences,advanced_frame_styles,advanced_ornaments,classic_layouts,uploads,generation_worker_leases,kiosk_sessions,events CASCADE');
    await rm(root,{ recursive: true,force: true });
  }
}
