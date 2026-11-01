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
try {
let input='';for await(const chunk of process.stdin)input+=chunk;
const c=JSON.parse(input),base='http://keycloak:8080/id';
async function request(path,method='GET',data,token){
 const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 if(!r.ok)throw Error('Keycloak request failed: '+method+' '+path+' status '+r.status);
 const body=await r.text();return body?JSON.parse(body):null;
}
const r=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:c.admin,password:c.secret})});
if(!r.ok)throw Error('Admin authentication failed: '+r.status);
const token=(await r.json()).access_token,realm='/admin/realms/novel-branches';
if(c.configureMcp){
 const resource=c.origin+c.basePath+'/mcp';
 const [server]=await request(realm+'/clients?clientId=novel-mcp','GET',null,token);
 if(!server)throw Error('MCP resource client not found');
 await request(realm+'/clients/'+server.id,'PUT',{attributes:{...server.attributes,resource_url:resource}},token);
 const [existing]=await request(realm+'/clients?clientId=novel-chatgpt','GET',null,token);
 const client={clientId:'novel-chatgpt',name:'Novel Branches — ChatGPT read only',enabled:true,protocol:'openid-connect',publicClient:false,clientAuthenticatorType:'client-secret',standardFlowEnabled:true,directAccessGrantsEnabled:false,implicitFlowEnabled:false,serviceAccountsEnabled:false,fullScopeAllowed:false,consentRequired:true,redirectUris:[c.callback],webOrigins:[],attributes:{'pkce.code.challenge.method':'S256','use.refresh.tokens':'true','oauth2.device.authorization.grant.enabled':'false'},defaultClientScopes:['basic','novels:read'],optionalClientScopes:['profile','offline_access'],protocolMappers:server.protocolMappers.map(({id,...mapper})=>mapper)};
 if(existing){const saved=await request(realm+'/clients/'+existing.id+'/client-secret','GET',null,token);if(saved.value!==c.mcpSecret)throw Error('Stored ChatGPT client secret differs; restore the existing credential instead of rotating it');await request(realm+'/clients/'+existing.id,'PUT',{...client,attributes:{...existing.attributes,...client.attributes}},token);}
 else {await request(realm+'/clients','POST',{...client,secret:c.mcpSecret},token);}
 const [configured]=await request(realm+'/clients?clientId=novel-chatgpt','GET',null,token);
 const scopes=await request(realm+'/client-scopes','GET',null,token);
 const readScope=scopes.find(s=>s.name==='novels:read'),offlineScope=scopes.find(s=>s.name==='offline_access');
 if(!readScope||!offlineScope)throw Error('Required read/offline client scope missing');
 // Update existing scope links explicitly; client PUT alone does not reliably change them.
 await request(realm+'/clients/'+configured.id+'/optional-client-scopes/'+readScope.id,'DELETE',null,token);
 await request(realm+'/clients/'+configured.id+'/default-client-scopes/'+readScope.id,'PUT',null,token);
 await request(realm+'/clients/'+configured.id+'/optional-client-scopes/'+offlineScope.id,'PUT',null,token);
 const role=await request(realm+'/roles/novel-member','GET',null,token);
 const offlineRole=await request(realm+'/roles/offline_access','GET',null,token);
 await request(realm+'/clients/'+configured.id+'/scope-mappings/realm','POST',[role,offlineRole],token);
}
if(c.configure){
 const [client]=await request(realm+'/clients?clientId=novel-web','GET',null,token);
 if(!client)throw Error('Web client not found');
 const home=c.origin+c.basePath+'/';
 await request(realm+'/clients/'+client.id,'PUT',{redirectUris:[home+'auth/callback'],webOrigins:[c.origin],rootUrl:home,baseUrl:home,attributes:{...client.attributes,'post.logout.redirect.uris':home,'backchannel.logout.url':'http://app:3000'+c.basePath+'/auth/backchannel-logout'}},token);
}
for(const u of c.users){
 const existing=await request(realm+'/users?exact=true&username='+encodeURIComponent(u.username),'GET',null,token);
 if(c.disable){if(existing.length){await request(realm+'/users/'+existing[0].id,'PUT',{enabled:false},token);await request(realm+'/users/'+existing[0].id+'/logout','POST',null,token);}continue;}
 if(existing.length&&!c.resume)throw Error('User already exists; no changes made to that user');
 if(!existing.length)
 await request(realm+'/users','POST',{username:u.username,enabled:true,firstName:u.display,lastName:u.last||undefined,email:u.email||undefined,credentials:[{type:'password',value:u.password,temporary:u.temporary}],requiredActions:u.temporary?['UPDATE_PASSWORD']:[]},token);
 const [created]=await request(realm+'/users?exact=true&username='+encodeURIComponent(u.username),'GET',null,token);
 if(existing.length&&c.resume)await request(realm+'/users/'+created.id,'PUT',{firstName:u.display,lastName:u.last,email:u.email,enabled:true,requiredActions:[]},token);
 if(existing.length)await request(realm+'/users/'+created.id+'/reset-password','PUT',{type:'password',value:u.password,temporary:u.temporary},token);
 if(u.member){const role=await request(realm+'/roles/novel-member','GET',null,token);await request(realm+'/users/'+created.id+'/role-mappings/realm','POST',[role],token);}
}
console.log(c.configureMcp?'ChatGPT OAuth client configured':c.configure?'Web callback/logout URLs configured':c.disable?'Verification users disabled':'Users created');
} catch(e) { console.error(e.message);process.exitCode=1; }
'''
p=argparse.ArgumentParser()
p.add_argument('--configure-mcp',action='store_true');p.add_argument('--chatgpt-callback',default='https://chatgpt.com/connector_platform_oauth_redirect');p.add_argument('--configure-web',action='store_true');p.add_argument('--username');p.add_argument('--display-name');p.add_argument('--email')
p.add_argument('--create-verification',action='store_true');p.add_argument('--disable-verification',action='store_true')
a=p.parse_args();cfg=envfile('deploy/.env');users=[]
verify=Path('deploy/.test/public.env')
if a.configure_mcp:
    import re
    if not re.fullmatch(r'https://chatgpt\.com/(connector_platform_oauth_redirect|connector/oauth/[A-Za-z0-9_-]+)',a.chatgpt_callback):p.error('Use the exact HTTPS ChatGPT callback; no wildcards, queries, or fragments')
    resource=cfg['APP_ORIGIN']+cfg.get('APP_BASE_PATH','')+'/mcp'
    envpath=Path('deploy/.env')
    lines=envpath.read_text().splitlines()
    lines=[line for line in lines if not line.startswith('OIDC_MCP_AUDIENCE=')]
    envpath.write_text('\n'.join(lines)+'\nOIDC_MCP_AUDIENCE='+resource+'\n')
    if not cfg.get('MCP_CHATGPT_CLIENT_SECRET'):
        cfg['MCP_CHATGPT_CLIENT_SECRET']=secrets.token_urlsafe(48)
        with open('deploy/.env','a') as f:f.write('\nMCP_CHATGPT_CLIENT_SECRET='+cfg['MCP_CHATGPT_CLIENT_SECRET']+'\n')
        Path('deploy/.env').chmod(0o600)
elif a.configure_web:
    pass
elif a.create_verification:
    verify.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if verify.exists():
        values=envfile(verify)
    else:
        values=None
    fresh=values is None
    if fresh:values={'APP_ORIGIN':cfg['APP_ORIGIN'],'TEST_USER_PREFIX':'verify-'+secrets.token_hex(4)+'-'}
    for name in ['member','other','outsider']:
        password=secrets.token_urlsafe(32) if fresh else values['TEST_'+name.upper()+'_PASSWORD'];values['TEST_'+name.upper()+'_PASSWORD']=password
        users.append(dict(username=values['TEST_USER_PREFIX']+name,display='Test',last=name,email=values['TEST_USER_PREFIX']+name+'@example.invalid',password=password,temporary=False,member=name!='outsider'))
    values['APP_ORIGIN']=cfg['APP_ORIGIN']
    values['APP_BASE_PATH']=cfg.get('APP_BASE_PATH','')
    if fresh:
        with os.fdopen(os.open(verify,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'w') as f:f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
    else:
        verify.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
elif a.disable_verification:
    values=envfile(verify)
    users=[dict(username=values['TEST_USER_PREFIX']+n) for n in ['member','other','outsider']]
else:
    if not a.username or not a.display_name:p.error('--username and --display-name are required')
    password=getpass.getpass('Initial temporary password (at least 12 characters): ')
    if len(password)<12 or password!=getpass.getpass('Repeat password: '):p.error('Passwords must match and contain at least 12 characters')
    users=[dict(username=a.username,display=a.display_name,email=a.email,password=password,temporary=True,member=True)]
r=subprocess.run(DC+['exec','-T','app','node','--input-type=module','-e',JS],input=json.dumps(dict(admin=cfg.get('KC_ADMIN_USER','admin'),secret=cfg['KC_ADMIN_PASSWORD'],users=users,disable=a.disable_verification,resume=a.create_verification,configure=a.configure_web,origin=cfg['APP_ORIGIN'],basePath=cfg.get('APP_BASE_PATH',''),configureMcp=a.configure_mcp,callback=a.chatgpt_callback,mcpSecret=cfg.get('MCP_CHATGPT_CLIENT_SECRET'))),text=True,capture_output=True)
if r.returncode:
    message=r.stderr.strip()
    for secret in [cfg['KC_ADMIN_PASSWORD'],cfg.get('MCP_CHATGPT_CLIENT_SECRET','')]+[u.get('password','') for u in users]:
        if secret:message=message.replace(secret,'[redacted]')
    print('Account operation failed: '+message);raise SystemExit(1)
print(r.stdout.strip())
