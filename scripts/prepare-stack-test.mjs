// Creates only disposable local fixtures; never reads production credentials.
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const directory=resolve('deploy/.test'),tls=resolve(directory,'tls');
mkdirSync(tls,{recursive:true});
const secret=()=>randomBytes(32).toString('hex');
const passwords={member:secret(),other:secret(),outsider:secret()};
const realm=JSON.parse(readFileSync('deploy/keycloak/novel-branches-realm.json','utf8'));
realm.users=Object.entries(passwords).map(([name,password])=>({username:'test-'+name,enabled:true,email:`${name}@example.test`,emailVerified:true,firstName:'Test',lastName:name,credentials:[{type:'password',value:password,temporary:false}],realmRoles:name==='outsider'?[]:['novel-member'],requiredActions:[]}));
// Password grant is enabled ONLY in this ignored test fixture, never in the shipped realm.
realm.clients.find(c=>c.clientId==='novel-mcp').directAccessGrantsEnabled=true;
writeFileSync(resolve(directory,'test-realm.json'),JSON.stringify(realm),{mode:0o600});
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout',resolve(tls,'privkey.pem'),'-out',resolve(tls,'fullchain.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
chmodSync(resolve(tls,'privkey.pem'),0o600);
const env={PUBLIC_HOST:'localhost',APP_ORIGIN:'https://localhost:8443',TLS_DIR:tls,HTTP_BIND:'127.0.0.1',HTTPS_BIND:'127.0.0.1',HTTP_PORT:'8088',HTTPS_PORT:'8443',OIDC_CLIENT_SECRET:secret(),KC_DB_PASSWORD:secret(),KC_ADMIN_PASSWORD:secret(),KC_ADMIN_USER:'test-admin',KEYCLOAK_REALM_FILE:resolve(directory,'test-realm.json'),TEST_MEMBER_PASSWORD:passwords.member,TEST_OTHER_PASSWORD:passwords.other,TEST_OUTSIDER_PASSWORD:passwords.outsider};
writeFileSync(resolve(directory,'stack.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
console.log('Disposable stack fixtures prepared in deploy/.test (gitignored).');
