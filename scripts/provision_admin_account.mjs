/** Run inside the existing API container; the email is explicitly supplied by the owner. */
import {PrismaClient} from '@prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {randomBytes} from 'node:crypto'
const email=process.argv[2]?.trim().toLowerCase()
if(!email||!email.includes('@'))throw new Error('An authorized existing account email is required')
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})})
try{
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('nxbooth-admin-registry'))`
  const account=await tx.nxAccount.findUnique({where:{email}})
  if(!account||account.status!=='active')throw new Error('The authorized account must already exist and be active')
  const existing=await tx.nxAdminUser.findMany({where:{email:{equals:email,mode:'insensitive'}}})
  if(existing.length>1)throw new Error('Duplicate admin entries require review')
  const data={name:account.display_name||'Studio owner',email,role:'superadmin',is_active:true}
  const actor=existing[0]?await tx.nxAdminUser.update({where:{id:existing[0].id},data}):await tx.nxAdminUser.create({data:{id:randomBytes(16).toString('hex'),...data}})
  await tx.nxAdminUser.updateMany({where:{id:'token-admin',email:null},data:{is_active:false,name:'Retired admin access'}})
  await tx.nxAuditLog.create({data:{id:randomBytes(16).toString('hex'),admin_actor_id:actor.id,action:'admin_account_access_configured',target_type:'admin_user',target_id:actor.id,reason:'Account-based admin sign-in explicitly requested by studio owner',metadata_json:JSON.stringify({account_id:account.id})}})
 })
 console.log(JSON.stringify({accessConfigured:true,role:'superadmin',customerCreditsChanged:false}))
}finally{await db.$disconnect()}
