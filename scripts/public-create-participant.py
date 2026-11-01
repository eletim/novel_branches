#!/usr/bin/env python3
"""Create a participant without printing credentials; existing users are read-only."""
import argparse, json, os, re, secrets, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
os.chdir(ROOT)
JS=r'''
try {
let input='';for await(const chunk of process.stdin)input+=chunk;
const c=JSON.parse(input),base='http://keycloak:8080/id';
const login=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:c.admin,password:c.secret})});
if(!login.ok)throw Error('Admin authentication failed');const token=(await login.json()).access_token;
async function request(path,method='GET',data){const r=await fetch(base+'/admin/realms/novel-branches'+path,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});if(!r.ok)throw Error('Account request failed: HTTP '+r.status);const text=await r.text();return text?JSON.parse(text):null;}
let [user]=await request('/users?exact=true&username='+encodeURIComponent(c.username));let created=false;
if(!user&&c.create){await request('/users','POST',{username:c.username,firstName:c.display,enabled:true,requiredActions:['UPDATE_PASSWORD'],credentials:[{type:'password',value:c.password,temporary:true}]});[user]=await request('/users?exact=true&username='+encodeURIComponent(c.username));created=true;const role=await request('/roles/novel-member');await request('/users/'+user.id+'/role-mappings/realm','POST',[role]);}
if(!user){console.log(JSON.stringify({exists:false}));}
else {const roles=await request('/users/'+user.id+'/role-mappings/realm/composite');console.log(JSON.stringify({exists:true,created,username:user.username,display:user.firstName,enabled:user.enabled,requiredActions:user.requiredActions,roles:roles.map(r=>r.name)}));}
} catch {console.error('Account operation failed; credentials suppressed');process.exitCode=1;}
'''
p=argparse.ArgumentParser();p.add_argument('--username',required=True);p.add_argument('--display-name',required=True);p.add_argument('--initial-password-file',required=True)
a=p.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9_-]{2,40}',a.username) or not 1<=len(a.display_name)<=60:p.error('Invalid username/display name')
cfg=dict(line.split('=',1) for line in Path('deploy/.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
base=dict(admin=cfg.get('KC_ADMIN_USER','admin'),secret=cfg['KC_ADMIN_PASSWORD'],username=a.username,display=a.display_name)
def run(values):
    result=subprocess.run(['docker','compose','--env-file','deploy/.env','-f','deploy/compose.public.yaml','exec','-T','app','node','--input-type=module','-e',JS],input=json.dumps(values),text=True,capture_output=True)
    if result.returncode:raise RuntimeError('Account operation failed; credentials suppressed')
    return json.loads(result.stdout)
try:
    state=run(base)
    if state['exists']:
        print('Existing account preserved (no changes): '+json.dumps(state,ensure_ascii=False));raise SystemExit(0)
    target=Path(a.initial_password_file).expanduser().absolute();target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if target.parent.stat().st_mode & 0o077:raise RuntimeError('Password directory must be private (0700)')
    password=secrets.token_urlsafe(32)
    # Reserve and persist before creating the account; never overwrite an existing file.
    with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as f:
        f.write(password+'\n');f.flush();os.fsync(f.fileno())
    state=run(dict(base,create=True,password=password))
    if not state.get('created'):
        target.unlink() # Only our newly-created unused file; existing account unchanged.
        print('Account appeared concurrently; existing account preserved: '+json.dumps(state,ensure_ascii=False))
    else:
        print('Participant created: '+json.dumps(state,ensure_ascii=False));print('Initial password saved privately to '+str(target))
except (OSError,RuntimeError,ValueError):
    print('Participant operation failed; credentials suppressed. Check account state and the private file before retrying.');raise SystemExit(1)
