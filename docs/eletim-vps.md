# eletim.jp VPS運用

公開URL: **https://eletim.jp/novel/**。配置先 `/home/ubuntu/novel_branches`。

既存CaddyでTLS終端・HTTP転送・証明書自動更新を継続し、`/novel/*` とKeycloakログイン用の `/id/realms/novel-branches/*`、`/id/resources/*` のみを小説用Nginxへ転送する。`/` は `/novel/`、`/novel` は末尾スラッシュ付きへ転送。他のパスは404、廃止した `/ntfy*` は410。DNS変更はしていない。

`APP_ORIGIN=https://eletim.jp`、`APP_BASE_PATH=/novel`。Keycloakのissuerは従来の `https://eletim.jp/id/realms/novel-branches` を維持し、既存ユーザー・作者IDを引き継ぐ。Webクライアントのcallbackは `https://eletim.jp/novel/auth/callback`、ログアウト後は `https://eletim.jp/novel/`、backchannel logoutは内部の `http://app:3000/novel/auth/backchannel-logout`。参加者は `novel-member`、作品の閲覧・投稿はログイン必須。

セッションとOIDCブラウザ確認Cookieは `__Host-` を維持するため **Path=/**、Secure、HttpOnly、SameSite=Lax。`__Host-` Cookieを `/novel/` Pathへ変更するとブラウザが拒否するため、ルートのまま使用する。Keycloak自身のCookieは `/id/` 側で管理する。APIのOrigin検証はパスを含まない `https://eletim.jp` と照合する。

## ntfyの公開撤去

ntfy 2.27.0は `base-url=https://eletim.jp/ntfy/` を指定すると「hosting ntfy on a sub-path is not supported」で起動を拒否することを実機で確認した（[公式実装](https://github.com/binwiederhier/ntfy/blob/v2.27.0/cmd/serve.go)）。通知UIや各クライアントまで安全にサブパス対応するにはntfy自体の改造が必要なため、ユーザー承認に従い停止・公開撤去した。`/ntfy/` での通知送受信は提供しない。旧URLを使用する通知クライアントも利用不可。

停止前にntfyを停止して `/home/ubuntu/notify-server` 全体（設定、認証DB、通知キャッシュ、Caddy証明書・設定を含む）を `/home/ubuntu/ntfy-backups/before-subpath.tgz` にバックアップした。ファイル0600、ディレクトリ0700、同じ場所にSHA256。アーカイブ読み取り検証済み。旧Caddyfile単体は `/home/ubuntu/notify-server/Caddyfile.before-novel-subpath` にも保持。

`notify-server-ntfy` コンテナは停止・restart=no。元の設定・データは削除していない。`notify-server-caddy` は小説サイトのTLS入口として継続使用する。既存通知用Composeを一括 `up` するとntfyが再起動するので、Caddyのみの操作には `docker restart notify-server-caddy` を使う。

## 起動・停止・ログ

```bash
ssh ubuntu@eletim.jp
cd /home/ubuntu/novel_branches
dc() { docker compose --env-file deploy/.env -f deploy/compose.public.yaml "$@"; }
dc up -d --build
dc ps
dc stop
dc logs --tail=100 app keycloak nginx
```

`restart: unless-stopped` と有効化済みのDocker systemdサービスでOS再起動後に起動する。`stop` したサービスは明示的に `up -d` する。`down -v` を使わない。VPS自体の再起動は実施しない。

Caddyのネットワーク `notify-server_default` を公開用Composeのedgeネットワークとして再利用する。アプリ・Keycloak・PostgreSQLはホストにポートを公開せず、内部ネットワークへ隔離。Nginxの8089/8449は127.0.0.1限定、8449のTLSリスナーはこの構成では使用しない。管理パス、master realm、healthはNginxで拒否する。

秘密値は `deploy/.env` (0600)。再生成しない。`docker compose config` は `--quiet` を付け、`docker inspect` や環境変数の全出力を共有しない。1GB VPSに合わせKeycloakヒープは64–160MiB、コンテナ上限512MiB。2GiBのswap `/var/swap.novel` を追加し `/etc/fstab` に登録済み。メモリ使用状況を監視し、利用増加時は増強する。

## 参加者追加

```bash
python3 scripts/public-admin.py --username alice --display-name 'アリス'
# 必要なら --email alice@example.com を追加
```

初回用パスワードを非表示プロンプトで2回入力する。履歴・引数・ログに秘密値を渡さない。参加者には `novel-member` が付与され、初回ログイン時にパスワード変更が必須。Keycloakの必須プロフィール（メール・姓など）が不足している場合も初回画面で本人が入力する。初回パスワードは本人へ別の安全な手段で連絡する。自己登録は無効。管理APIはDocker内部でのみ利用する。既存ユーザーは上書きしない。

## 更新

1. ローカルで対象ブランチを選び、`npm ci && npm test`。変更をcommit・pushする。mainへ自動マージしない。
2. VPSで `scripts/public-backup.sh` を実行し、両DB・秘密値・コミットを退避する。
3. `git fetch origin`、差分を確認して配置ブランチを `git switch`、`git pull --ff-only`。GitHub認証がVPSにない場合はローカルからGit bundleを転送してfetchする。今回の初期転送後、Git bundleからVPS側のGit checkoutを整備済み。秘密値や既存DBは転送しない。
4. `dc config --quiet`、`dc build`、`dc up -d`、`dc exec nginx nginx -s reload`（再作成されたコンテナのIPを再解決）。HTTPS、認証、既存作品を確認する。realm JSONの変更は既存realmに自動反映されないため、必要な管理API移行を別途実施する。
5. DB移行を含む更新の取り消しは、同じ時点の両DBと対応コミットをセットで復元する。片方だけ過去に戻さない。

## バックアップ

```bash
scripts/public-backup.sh                 # 既定: /home/ubuntu/novel-backups/UTC日時
scripts/public-backup.sh /安全な保存先
```

Nginx・アプリ・Keycloakの全書き込み元を停止し、PostgreSQLのdumpとSQLiteディレクトリ（WAL含む）を取得する。同一停止期間の組を使う。完了・失敗時はサービスを再起動するので短時間の停止がある。秘密値、Compose、Caddyfile、コミット、SHA256も同梱。フォルダは0700、ファイルは0600で、Git管理外。サーバー障害に備え、このディレクトリを暗号化して別ホストにも保存する。自動定期実行は未設定。

## 両DBの復元

復元先のコードはバックアップ内 `commit.txt` と一致させる。`SHA256SUMS` を確認し、**既存本番volumeには上書きせず**未使用のプロジェクトへ復元する。

```bash
scripts/public-restore.sh /home/ubuntu/novel-backups/対象日時 novel-restore-yyyymmdd
```

両DBを新しい名前付きvolumeに復元し、SQLite integrityと作品数・Keycloakユーザー数を確認して停止する。本番データ・稼働サービスは変更しない。復元用プロジェクトのvolumeは維持される。

切り替えが必要になった時点で停止時間と復元以降に失われる投稿を確認する。現在の本番もバックアップし、`dc stop` 後、バックアップの秘密値を0600で戻し `COMPOSE_PROJECT_NAME` を復元先へ合わせる。HTTP/HTTPSの127.0.0.1バインドとCaddyのネットワーク設定を維持する。Caddyのupstreamを復元先Nginxコンテナ名へ更新してvalidate/reloadする。`docker compose --env-file deploy/.env -f deploy/compose.public.yaml up -d` のあとログイン・作者対応・作品・分岐・評価を確認する。旧volumeは削除しない。

## サブパス認証設定の更新

既存realmは再インポートでは更新しない。パス変更時は `.env` の `APP_BASE_PATH` を変更してから `python3 scripts/public-admin.py --configure-web` で既存クライアントのcallback/logout/backchannelを更新する。クライアントsecret・realm・ユーザー・DB・issuerは再生成しない。`dc up -d --build` 後、Keycloak discoveryが200に戻るまで待ち、Nginxをreloadする。

## Caddyと証明書

設定 `/home/ubuntu/notify-server/Caddyfile`、正本はリポジトリの `deploy/caddy/Caddyfile.eletim`。永続証明書 `/home/ubuntu/notify-server/data/caddy/data`。証明書は既存のLet's Encrypt証明書を利用し、Caddyが自動更新する（[公式仕様](https://caddyserver.com/docs/automatic-https)）。証明書ファイルをNginxへコピーする運用は不要。80/443をCaddyに開放したままにする。Caddy管理ポート2019はホストに公開しない。

```bash
docker exec notify-server-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec notify-server-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
openssl s_client -connect eletim.jp:443 -servername eletim.jp </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer
```

公開構成は `deploy/compose.public.yaml` 単独。Caddy用には `NGINX_TEMPLATE=./nginx/caddy.conf.template` を指定する。外部入力の転送ヘッダーはNginxで上書きし、Keycloakの公開issuerは `https://eletim.jp/id/realms/novel-branches` 固定（[Keycloak公式](https://www.keycloak.org/server/reverseproxy)）。

## 2026-11-01 配置作業中の障害

初回起動ではKeycloakのJavaヒープのみ256MiBに制限し、コンテナ全体の上限を設定していなかった。realm初期化完了後にVPSのSSH・HTTPSがタイムアウトし、pingのみ応答する状態を観測した。直前の空きメモリ約124MiBからメモリ逼迫を疑っているが、ホストログ未取得のため原因は未確定。公開先切り替え前に発生。修正でKeycloakコンテナ全体のメモリ上限を追加した。SSH経由でKeycloakを停止し復旧した。2GiBのswapを新設し永続化、Javaヒープ160MiB・メタスペース256MiB・コンテナ全体512MiBに設定した。128MiBのメタスペース制限は不足しJavaのOutOfMemoryErrorを確認したため増量した。VPSの再起動はしていない。

## 配置前の検証記録（旧ルートURL）

- `npm test`: 21件成功（サブパスでのPKCE/callback・投稿・Origin検証・Cookie・ログアウトを含む）。依存監査: 脆弱性0件。
- VPS上の正式TLSを、SSHトンネルと専用Caddyから本番用Nginxへ接続して検証。証明書検証を無効化していない。既存の公開Caddy/ntfyの転送先は変更していない。
- 実Chromium: 2人のログイン、ログアウト、参加ロールなし拒否、新作、続話、分岐、入れ子の分岐、各経路の読む順番、グッド追加/取消/重複抑止、検索・並べ替え、下書き、競合、別ユーザーへの誤投稿防止、PC/スマホ幅を確認。
- 管理パス・master realm・healthは404、未ログインの作品APIは401。ログに秘密値・認可コードqueryの混入なし。
- 全4サービスの再起動前後でユーザー・作品・分岐・本文・票のSHA256が一致。VPS自体は再起動していない。
- バックアップから別プロジェクト `novel-restore-check-20261101-b` へ復元し、SQLite integrity OK、Keycloakユーザー4件を確認。最新バックアップでも `novel-restore-final-20261101` へ復元し、作品2件・分岐6件・話12件・グッド2件と作者情報のSHA256が本番DBと完全一致した。検証用復元コンテナは停止済み、volumeは保持。
- 検証用アカウントはランダムな `verify-` 接頭辞の3名。本番の初期realmにローカル検証ユーザーをインポートしていない。新規に作った「ブラウザ検証」作品は検証記録として保持する。終了時に専用3名を無効化し、Keycloakのセッションもログアウトする。
- この時点では公開切り替え前。以降の最終構成は冒頭と公開後の検証結果を参照。

最新の検証済みバックアップ: `/home/ubuntu/novel-backups/20261031T232939Z`（日本時間2026-11-01 08:29:39、コード0a1e9eb）。検証アカウント3名は無効化・セッションログアウト済み。検証作品2件は削除していない。この後、承認されたサブパス構成へ移行した。

## サブパス公開の検証（2026-11-01）

移行前バックアップ: `/home/ubuntu/novel-backups/20261031T234558Z`。移行前後で作者2名・作品2件・分岐6件・話12件・グッド2件のハッシュ一致。SQLite/Keycloak DBの初期化・volume削除・秘密値再生成なし。

Caddy設定の単一ファイルbind mountが旧inodeを参照し、最初のreloadでは旧ntfy転送が残った。候補設定を明示してreloadした後にCaddyコンテナを再起動し、ホストとコンテナ内の設定一致を確認して解消した。VPS自体は再起動していない。今後設定差し替え時もコンテナ内の内容と公開応答を確認する。

ブラウザ検証: `TEST_STACK_ENV=deploy/.test/public.env npm run test:browser`。
セッションの実時間期限確認: `node scripts/test-public-expiry.mjs`（約5分、パスワードgrantは使用しない）。認証情報・trace/HARは出力しない。証跡はローカルのGit管理外 `deploy/.test/evidence`。検証アカウントは終了後 `python3 scripts/public-admin.py --disable-verification` で無効化・ログアウトする。検証作品は既存作品とともに保持する。

公開後の実ブラウザ確認は全件成功。HTTPS・静的ファイル・未ログイン導線、2人のログイン/ログアウト、新作/続話/分岐/入れ子、読書順/グッド、下書き・競合・誤投稿防止、PC/スマホ幅、`/novel/` のパス保持とロール拒否を確認。実時間約5分のCookie期限後、投稿401・下書き保持・Keycloak SSO・同じ作者IDでの下書き復元・ログアウトも成功。`/novel/health` を含む管理経路は404、未認証作品API401、`/ntfy/` は410。検証アカウント3名は終了後に再び無効化・セッション失効。新たな検証作品1件を含め計3件の検証作品を記録として保持し、既存作品は削除していない。

## ChatGPT用の閲覧専用MCP

公開MCP: `https://eletim.jp/novel/mcp`。登録値と具体的なChatGPT操作は [mcp.md](mcp.md#chatgptからの認証付き接続eletimjp)。既存Webとissuerは維持し、`novel-chatgpt` という別のconfidentialクライアントを設定した。secretは `deploy/.env` の `MCP_CHATGPT_CLIENT_SECRET` (0600)、Git管理外。`OIDC_MCP_AUDIENCE=https://eletim.jp/novel/mcp`。管理ユーザー `novel-admin` と参加者を混同しない。

変更前バックアップ: `/home/ubuntu/novel-backups/20261101T000624Z`。新secretを含む変更後バックアップも必ず保存する。通常の両DBバックアップに `.env` と現在のCaddyfileが含まれる。更新ではsecretを再生成しない。

Caddyは `/novel/*` に加え、PRMのRFC 9728標準パスとissuerのRFC 8414メタデータだけを正確一致で公開する。DCR・Keycloak管理・master realmは非公開。Nginxのテンプレート変更後は `dc up -d --no-deps --force-recreate nginx` でファイルbind mountを再作成する。Caddyfileは事前validate後に `cat deploy/caddy/Caddyfile.eletim > /home/ubuntu/notify-server/Caddyfile` で現在のinodeを保って反映し、コンテナ内の内容を確認してreloadする。

ChatGPT本体の接続登録はユーザー操作が必要。登録画面の正確なcallbackが設定済みstable URLと異なる場合のみ `python3 scripts/public-admin.py --configure-mcp --chatgpt-callback '画面のURL'` を実行し、そのURIだけを許可する。秘密値は画面入力に使い、チャットには貼らない。

変更後の最終バックアップ: `/home/ubuntu/novel-backups/20261101T003013Z`（日本時間2026-11-01 09:30:13）。新しいChatGPTクライアントsecret・canonical audience設定・Keycloakの専用クライアントを両DBと組にして保存し、SHA256を確認した。外部MCP OAuthの実時間約5分の期限切れ401と、refreshによる本文閲覧権限の復帰を確認。検証用3アカウントは無効化・セッション失効し、Web回帰確認で追加した検証作品は記録として保持した。ChatGPT本体の接続は未確認で、登録・参加者の本人ログイン・会話からの4ツール呼び出しが残る。

ログ対策: Nginxの通常アクセスログはqueryを省いたpath/statusのみ。大きなKeycloak CSSのbuffer警告がRefererの認証stateを記録するケースを検出したため、Nginxのエラーログはcritical以上に制限し、診断にはpath/statusログを使用する。CaddyのruntimeログからHTTP requestオブジェクト全体を除き、接続障害時にもcallback query・Cookie・Authorizationを記録しない。パスワード・client secret・アクセストークンのログ出力は検出されていない。
