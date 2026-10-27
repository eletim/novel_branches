# 既存Tailscale内から利用する

ユーザーのVPN起動依頼により、localhost環境を同じデータのままVPN用URLへ移行した。新しいVPNへの参加、Funnel、公開DNS変更は行わない。

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 24
npm run vpn -- up
npm run vpn -- status
npm run vpn -- restart
npm run vpn -- stop
```

URLは起動完了時の `VPN ready:` またはGit管理外の `deploy/.test/vpn.env` のAPP_ORIGINで確認する。`https://このPCのTailscale名.ts.net:8443`。同じtailnetに接続した端末から開く。Keycloakアカウントとパスワードは以前のまま（`deploy/.test/stack.env`）。VPNのACLで到達を許可された端末のみ接続でき、その後さらにKeycloakログインが必要。

Tailscale ServeのTCP8443から `127.0.0.1:8443` のNginxへ転送する。アプリ、DB、Keycloakのポートは引き続き非公開。既存Serveの443/5173と各パスには触れない。HTTPの8088も127.0.0.1のまま。HTTPSはNginxで終端し、Tailscaleから取得した正式な証明書を使用する。検証無効化や自己署名証明書のインポートは不要。

`up` / `restart` はTailscaleの証明書を取得し直し、Nginxへ再読込する。書き出した証明書は自動更新されないため、失効前に `npm run vpn -- up` を実行する。この環境で取得した証明書の期限は2027-01-03。期限は `openssl x509 -in deploy/.test/vpn-tls/fullchain.pem -noout -enddate` で確認できる。

移行で変更するのは、この同じKeycloak realmの外部URL、Webクライアントのredirect/logout URL、SQLiteのissuer対応情報。作者ID・作品・分岐・グッドは維持する。古いログインセッションは失効させる。URLが変わるため、localhostのlocalStorageにある下書きはVPN URLに自動移行されない。必要な下書きは以前のブラウザのlocalhostのサイトデータから控えて移す。

移行前のSQLiteはアプリvolume内の `/app/data/before-vpn.db`、Keycloak DBは `deploy/.test/backups/keycloak-before-vpn.dump`、元のServe設定は同ディレクトリの `tailscale-serve-before.json` に保存した。いずれも秘密情報を含み得るためGitへ追加しない。通常操作でvolumeやバックアップを消さない。

移行後は `npm run local` によるlocalhost設定への上書きを拒否する。以前のlocalhost URLではなくVPN URLを使用する。元へ戻すには、Serveの小説用TCP8443停止だけではなく、KeycloakのURLと作者のissuer対応も戻す必要がある。DB全体を古いバックアップへ戻すと移行後の投稿を失うため、単純なDB復元は行わない。

## 実施結果

2026-10-27、同じホストのTailscale経路から正式な証明書を検証して接続成功。実ChromeでKeycloakの2人ログイン、投稿・分岐・グッド・下書き・複数タブ・ログアウトを再確認。HTTP MCPの4ツールと権限拒否を再確認し、移行前の本文・分岐・作者ID・評価と一致した。全サービス再起動後のMCP照合も成功。移行前SQLiteとの比較で、ユーザーとsubject→作者ID対応が一致し、重複作者が作られていないことも確認した。別のVPN端末からの到達と、その端末向けのACL適用は未確認。

再実行：

```bash
TEST_STACK_ENV=deploy/.test/vpn.env npm run test:browser
TEST_STACK_ENV=deploy/.test/vpn.env node scripts/test-mcp-local.mjs
# VPN設定で再起動した後に保存内容を比較
npm run vpn -- restart
TEST_STACK_ENV=deploy/.test/vpn.env node scripts/test-mcp-local.mjs --compare
```

VPN接続したブラウザが必要。通常の `npm test` とCIは従来どおりlocalhost用の隔離環境を検証する。
