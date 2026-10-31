#!/usr/bin/env python3
"""Run from the deployment root on the VPS. Never print credentials."""
import argparse, getpass, json, os, secrets, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
os.chdir(ROOT)
DC=['docker','compose','--env-file','deploy/.env','-f','deploy/compose.public.yaml']
def envfile(p):
    return dict(line.split('=',1) for line in Path(p).read_text().splitlines() if line and not line.startswith('#') and '=' in line)
JS=r'''
let input='';for await(const chunk of process.stdin)input+=chunk;
const c=JSON.parse(input),base='http://keycloak:8080/id';
async function request(path,method='GET',data,token){
 const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 if(!r.ok)throw Error('Keycloak request failed: '+r.status);
 return r.status===204?null:r.json();
}
const r=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:c.admin,password:c.secret})});
if(!r.ok)throw Error('Admin authentication failed: '+r.status);
const token=(await r.json()).access_token,realm='/admin/realms/novel-branches';
for(const u of c.users){
 const existing=await request(realm+'/users?exact=true&username='+encodeURIComponent(u.username),'GET',null,token);
 if(c.disable){if(existing.length)await request(realm+'/users/'+existing[0].id,'PUT',{enabled:false},token);continue;}
 if(existing.length)throw Error('User already exists; no changes made to that user');
 await request(realm+'/users','POST',{username:u.username,enabled:true,firstName:u.display,email:u.email||undefined,credentials:[{type:'password',value:u.password,temporary:u.temporary}],requiredActions:u.temporary?['UPDATE_PASSWORD']:[]},token);
 const [created]=await request(realm+'/users?exact=true&username='+encodeURIComponent(u.username),'GET',null,token);
 if(u.member){const role=await request(realm+'/roles/novel-member','GET',null,token);await request(realm+'/users/'+created.id+'/role-mappings/realm','POST',[role],token);}
}
console.log(c.disable?'Verification users disabled':'Users created');
'''
p=argparse.ArgumentParser()
p.add_argument('--username');p.add_argument('--display-name');p.add_argument('--email')
p.add_argument('--create-verification',action='store_true');p.add_argument('--disable-verification',action='store_true')
a=p.parse_args();cfg=envfile('deploy/.env');users=[]
verify=Path('deploy/.test/public.env')
if a.create_verification:
    verify.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if verify.exists():p.error('Verification config already exists')
    values={'APP_ORIGIN':cfg['APP_ORIGIN'],'TEST_USER_PREFIX':'verify-'+secrets.token_hex(4)+'-'}
    for name in ['member','other','outsider']:
        password=secrets.token_urlsafe(32);values['TEST_'+name.upper()+'_PASSWORD']=password
        users.append(dict(username=values['TEST_USER_PREFIX']+name,display='Test '+name,password=password,temporary=False,member=name!='outsider'))
    with os.fdopen(os.open(verify,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'w') as f:f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
elif a.disable_verification:
    values=envfile(verify)
    users=[dict(username=values['TEST_USER_PREFIX']+n) for n in ['member','other','outsider']]
else:
    if not a.username or not a.display_name:p.error('--username and --display-name are required')
    password=getpass.getpass('Initial temporary password (at least 12 characters): ')
    if len(password)<12 or password!=getpass.getpass('Repeat password: '):p.error('Passwords must match and contain at least 12 characters')
    users=[dict(username=a.username,display=a.display_name,email=a.email,password=password,temporary=True,member=True)]
r=subprocess.run(DC+['exec','-T','app','node','--input-type=module','-e',JS],input=json.dumps(dict(admin=cfg.get('KC_ADMIN_USER','admin'),secret=cfg['KC_ADMIN_PASSWORD'],users=users,disable=a.disable_verification)),text=True,capture_output=True)
if r.returncode:
    print('Account operation failed; credentials were not printed. Inspect Keycloak status.');raise SystemExit(1)
print(r.stdout.strip())
