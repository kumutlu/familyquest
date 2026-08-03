const admin=require('firebase-admin');
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'familyquest-beta-402cb'});
const db=admin.firestore();
(async()=>{
  const users=await db.collection('users').get();
  const alis=users.docs.filter(d=>String(d.data().displayName||d.data().name||'').toLowerCase().includes('ali'));
  for(const u of alis){
    const fid=u.data().familyId;
    if(!fid){console.log(u.id,u.data().displayName||u.data().name,'NO FAMILY');continue;}
    const fam=await db.collection('families').doc(fid).get();
    console.log(JSON.stringify({user:u.id,name:u.data().displayName||u.data().name,role:u.data().role,familyId:fid,migration:fam.data()?.gamificationMigration}));
  }
})().catch(e=>{console.error(e);process.exit(1)});
