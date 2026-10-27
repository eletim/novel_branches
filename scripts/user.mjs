import { Store } from '../src/store.mjs';
const [command,username,displayName] = process.argv.slice(2);
if (command !== 'add' || !username || !displayName) {
  console.error('Usage: npm run user -- add <username> <表示名>\nパスワードは標準入力から1行で渡してください（10文字以上）。');process.exit(1);
}
console.error('パスワードを標準入力から読み込みます。');
let password = '';
for await (const chunk of process.stdin) { password += chunk; if(password.length > 1024) {console.error('入力が長すぎます。');process.exit(1);} }
const store = new Store();
try { const user = store.addUser(username,displayName,password.replace(/\r?\n$/,''));console.log(`作成しました: ${user.username} (${user.display_name})`); }
catch(e) {console.error(e.message);process.exitCode=1;}
finally {store.close();}
