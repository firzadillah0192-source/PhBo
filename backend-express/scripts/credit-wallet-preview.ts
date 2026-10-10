import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CustomerAccountModel } from '../src/models/customer-account.model.js';
import { CustomerAccountService } from '../src/services/customer-account.service.js';
import { hashCustomerPassword } from '../src/services/customer-credentials.service.js';
import { createMigrationApp } from '../src/migration-app.js';
import type { CustomerCatalogService } from '../src/services/customer-catalog.service.js';
const connectionString = process.env.CREDIT_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== '/nxbooth_credit_test') throw new Error('Dedicated test database required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const password = await hashCustomerPassword('Synthetic-wallet-preview-123');
for (const [id,email,remaining] of [['credit-ui','creator@example.invalid',50],['credit-low','low@example.invalid',9],['credit-exact','exact@example.invalid',10]] as const) {
  await db.nxAccount.upsert({where:{id},create:{id,email,password_hash:password,ai_quota_total:0},update:{password_hash:password}});
  await new CustomerAccountModel(db).wallet(id);
  await db.$executeRaw`UPDATE credit_wallets SET free_remaining=${remaining},top_up_remaining=0 WHERE account_id=${id}`;
  await db.$executeRaw`UPDATE accounts SET ai_quota_total=ai_quota_used+ai_quota_reserved+${remaining} WHERE id=${id}`;
}
if (process.argv.includes('--seed-only')) { await db.$disconnect(); process.exit(0); }
const account = new CustomerAccountService(new CustomerAccountModel(db), { sessionSecret: 'synthetic-credit-preview-secret', sessionDays: 1, cookieSecure: false });
const sample = (id:string,name:string) => ({id,name,enabled:true,preview_url:'/fixture-preview.svg',thumbnail:'/fixture-preview.svg',status:'published',basic_available:true,shot_count:3,description:'Synthetic catalog fixture',compatible_frame_style_ids:['natural'],max_ornaments:0});
const catalog = { async templates(){return {templates:[sample('scene-one','Space Commander'),sample('scene-two','Retro Explorer')]};}, async experiences(){return {experiences:[sample('creative-one','Neon Portrait'),sample('creative-two','Pixel World')]};}, async layouts(){return [sample('frame-one','Retro Strip'),sample('frame-two','Blue Frame')];}, async styles(){return [{id:'natural',name:'Natural',enabled:true}];}, async ornaments(){return [];} } as unknown as CustomerCatalogService;
const app = createMigrationApp(catalog, {corsOrigins:['http://127.0.0.1:5195']}, account);
const server = app.listen(5196,'127.0.0.1',()=>console.log('Synthetic credit preview listening on localhost:5196'));
process.on('SIGTERM',()=>server.close(()=>{void db.$disconnect();}));
