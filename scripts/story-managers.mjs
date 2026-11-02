// Internal CLI only. Credentials arrive on stdin from public-story-managers.py.
import {Store,AppError} from '../src/store.mjs';
import {pathToFileURL} from 'node:url';
export function resolveIdentity(store,issuer,subject) {
  const row=store.db.prepare('SELECT user_id FROM oidc_identities WHERE issuer=? AND subject=?').get(issuer,subject);
  if(!row)throw new AppError('既存のOIDC対応が見つかりません。本人の初回ログイン状態を確認してください。');
  if(!store.user(row.user_id))throw new AppError('対応するユーザーが見つかりません。');
  return row.user_id;
}
async function main(){
 let raw='';for await(const c of process.stdin){raw+=c;if(raw.length>16384)throw Error('Input too long');}const c=JSON.parse(raw);
 if(!['grant','revoke','list','audit'].includes(c.action))throw Error('Unsupported action');
 if(c.action!=='audit'&&!c.all&&(!Number.isSafeInteger(c.storyId)||c.storyId<1))throw Error('Specify one story');
 if(c.all&&c.action!=='grant')throw Error('Only grant supports --all-existing');
 const store=new Store();try{
  if(c.action==='list'){console.log(JSON.stringify({storyId:c.storyId,managers:store.storyManagers(c.storyId)}));return;}
  const issuer=process.env.OIDC_ISSUER;if(!issuer||issuer!==c.expectedIssuer)throw Error('Configured issuer mismatch');
  const base='http://keycloak:8080/id';const login=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:c.admin,password:c.secret})});
  if(!login.ok)throw Error('Admin authentication failed');const token=(await login.json()).access_token;
  async function get(path){const r=await fetch(base+'/admin/realms/novel-branches'+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Keycloak identity lookup failed');return r.json();}
  const users=(await get('/users?exact=true&username='+encodeURIComponent(c.username))).filter(u=>u.username===c.username);
  if(users.length!==1)throw Error('Exact Keycloak username was not uniquely resolved');const user=users[0];
  if(c.action==='grant'){const roles=await get('/users/'+user.id+'/role-mappings/realm/composite');if(!user.enabled||!roles.some(r=>r.name==='novel-member'))throw Error('Grant requires an enabled novel-member account');}
  const userId=resolveIdentity(store,issuer,user.id),identity={username:user.username,issuer,subject:user.id,userId};
  let result;if(c.action==='audit')result=store.storyManagementAudit(userId);
  else if(c.all)result=store.assignAllStoryManagers(userId);
  else result={storyId:c.storyId,managers:store.assignStoryManager(c.storyId,userId,c.action==='grant')};
  console.log(JSON.stringify({action:c.action,...identity,...result}));
 }finally{store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Story manager operation failed: check exact username, existing OIDC mapping, story ID and creator protection; credentials suppressed');process.exitCode=1;});
