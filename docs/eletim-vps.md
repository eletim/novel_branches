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

変更後の最終バックアップ: `/home/ubuntu/novel-backups/20261101T003417Z`（日本時間2026-11-01 09:34:17）。新しいChatGPTクライアントsecret・canonical audience設定・Keycloakの専用クライアントを両DBと組にして保存し、SHA256を確認した。外部MCP OAuthの実時間約5分の期限切れ401と、refreshによる本文閲覧権限の復帰を確認。検証用3アカウントは無効化・セッション失効し、Web回帰確認で追加した検証作品は記録として保持した。ChatGPT本体の接続は未確認で、登録・参加者の本人ログイン・会話からの4ツール呼び出しが残る。

ログ対策: Nginxの通常アクセスログはqueryを省いたpath/statusのみ。大きなKeycloak CSSのbuffer警告がRefererの認証stateを記録するケースを検出したため、Nginxのエラーログはcritical以上に制限し、診断にはpath/statusログを使用する。CaddyのruntimeログからHTTP requestオブジェクト全体を除き、接続障害時にもcallback query・Cookie・Authorizationを記録しない。パスワード・client secret・アクセストークンのログ出力は検出されていない。

ログ対策後は、隔離したCaddyで上流接続エラーを発生させ、擬似code/state・Referer・Authorization・Cookieがログに含まれないことを確認した。公開Keycloakログイン画面の大きなCSS読み込みも再確認し、稼働中ログの秘密値・認証クエリ検査はいずれも検出なし。

## ChatGPT offline scope対応（2026-11-01）

変更前バックアップ: `/home/ubuntu/novel-backups/20261101T011842Z`。`offline_access` を専用クライアントのoptional scopeとrole scopeに追加し、`novels:read` をdefault scopeへ移した。`openid offline_access` の実要求でも閲覧権限を明示した同意を経て発行できる。OAuth discoveryはoffline scopeを広告する。独自のMCP検証は引き続き署名・issuer・URL audience・期限・`novel-member`・`novels:read` を必須とする。

Keycloak 26.8.1のoffline refresh時のaudience差を補うため、canonical URLを付ける独立したAudience mapperを専用クライアントに設定する。client audienceとcustom audienceは別mapperにする。クライアントsecret、callback、既存Webクライアントは変更しない。参加者 `koji` のパスワード・ユーザー情報・ロール・同意は変更しない。設定詳細と再認証操作は [mcp.md](mcp.md#invalid_scope-openid-offline_access-の修正2026-11-01) を参照。

offline refresh tokenは通常のWeb SSO終了後も有効で、現設定のidle期限は30日。検証ユーザーを無効化するCLIは、検証ユーザーの専用クライアントへの同意・offline grantも取り消す。

検証結果: 自動テスト23件成功。外部ブラウザの認可コード＋PKCEで、3scopeと `openid offline_access` のみの要求、offline token（typ=Offline）発行、4つの閲覧ツール、更新後のURL audience、実時間約5分後の期限切れ拒否とoffline refreshによる復帰を確認。既存Webの2人ログイン・閲覧・新作/続話/分岐/グッド等の回帰確認も成功した。無関係な未知scopeは引き続きinvalid_scope。MCPのscope欠落・似た名前のscopeは署名付きトークンのテストで401。検証ユーザー3名は終了後に無効化し、専用クライアントの同意・offline grantも取り消した。

変更後バックアップ: `/home/ubuntu/novel-backups/20261101T013251Z`（日本時間2026-11-01 10:32:51）。DB・ユーザー・作品・client secret・callbackは保持。ChatGPT側では既存接続で再認証し、offline/readの同意を許可する。通常は再登録不要。ChatGPT本体での再接続成功は利用者の再試行後に確認する。

## 目次・話の共同投稿と編集（2026-11-01）

変更前の両DBバックアップ: `/home/ubuntu/novel-backups/20261101T031826Z`（コード254c339）。SQLiteコピーでv3移行を先行実行し、users/stories/branches/chapters/likes/oidc_identitiesの既存列のハッシュ一致、外部キー整合、全読書経路を確認した。5作品・15分岐・30話・5票と既存ユーザーを保持する追加移行。Keycloakの設定・秘密値・volumeは変更しない。

chaptersにauthor_id/updated_at/revisionを追加する。過去の話は当時の所属branch作者、作成日時、revision=1で補完する。以降は実際の投稿者を保存する。参加者ならどの経路にも続話・別案を追加できる。編集は話の制作者のみ、サーバーでも照合しexpectedRevisionによる競合拒否を行う。親子関係・制作者・グッドは編集で変更しない。共通話の編集は全経路とMCPに反映する。

作品ページは縦の目次とし、同じ親を持つ候補だけをbranchボタンで選ぶ。第一話・途中・入れ子の候補と本文・前後移動・目次復帰で経路を保持する。編集と続話の下書きには元のrevision/headを保持し、競合や通信失敗でも消さない。競合後は内容を退避してから明示的に最新状態を読み直し、入力を反映する。

公開反映はappだけをbuild/recreateし、Nginxをreloadした。`TEST_STACK_ENV=deploy/.test/public.env npm run test:browser`で実HTTPS・Keycloakログイン、他者の続話と作者表示、本人の編集成功/他者403、共有本文と更新日時、第一話/途中/入れ子の候補、経路保持、編集/投稿競合と入力・下書き復元、一時503時の入力保持、グッド・検索、PC/375pxモバイルを確認済み。証跡はGit管理外 `deploy/.test/evidence/episodes-public`。自動テスト27件成功。Dockerの隔離した全スタックテストはローカルでは未実行で、公開環境のブラウザとOAuth/MCPで回帰確認する。

v3移行後の取り消しは、この更新前の両DBバックアップと対応コードをセットで新しい復元用volumeへ戻す。旧版コードをv3 DBへ直接戻して書き込まない。現在の両DBも事前バックアップし、復元後に失う投稿・編集の範囲を確認する。`down -v`やDB初期化は不要。

今回追加した検証作品・話は検証記録として保持し、専用アカウントは検証終了後に無効化・セッション失効・MCP offline grant取消を行う。実利用者kojiの設定やパスワードは変更しない。

最終回帰確認: 外部の認可コード＋S256 PKCE、initialize/tools/list/tools/callと4ツール、編集後本文・話ごとの作者・revision・更新日時・入れ子経路、offline refresh後のcanonical audienceが成功。実時間のアクセストークン期限後は401、refresh後は閲覧可能。Web Cookieの実時間期限後も投稿拒否・入力と下書き保持・/novel/でSSO再ログイン・下書き復帰・ログアウトが成功した。これは独立したブラウザOAuth検証で、今回ChatGPT本体の会話から再接続操作はしていない（以前の作品一覧成功は利用者報告）。管理経路/master realm/healthは外部404、作品APIは未認証401。ログに秘密値・認可queryの検出なし。

公開後のDBも比較し、更新前のすべてのユーザー・作品・分岐・話・グッド・OIDC対応情報の既存列が保持されることを確認した。今回の検証作品1件と10話は削除せず記録として保持する。

検証終了後、専用3アカウントを無効化・ログアウトし、novel-chatgptの同意/offline grantを取り消した。最終両DBバックアップは `/home/ubuntu/novel-backups/20261101T033537Z`（更新後コードd6c57a3、文書への最終結果追記前）。秘密値・Caddy設定・対応コミットを含む。kojiは変更しない。

## 読者向けUIの整理（2026-11-01）

反映前の両DBバックアップ: `/home/ubuntu/novel-backups/20261101T035646Z`（1a8b757）。今回はフロントエンドと検証スクリプトの変更で、DB/Keycloak/秘密値/volumeの変更は不要。

目次は話数・タイトルを中心に、作者と更新日時を小さく表示する。右端のSVG分岐アイコンはスクリーンリーダー名・aria-expanded/aria-controls付き。候補は同じ親の他の話だけで、タイトルから本文へ移動し選択経路を引き継ぐ。目次から執筆操作を除いた。本文は目次・前後移動・分岐・グッドを残し、右上の小さなEditorから本人の編集/最新話への続話/同じ話の別案/次話からの分岐を開く。権限・revision/head競合検出・下書きキーは変更していない。ヘッダーの新作投稿を控えめにし、一覧の大きな執筆案内を除いた。

検証は `npm test`、`node scripts/test-episodes-browser.mjs --local`、VPS反映後の `TEST_STACK_ENV=deploy/.test/public.env npm run test:browser` を使用する。ブラウザ検証は候補の本文遷移、目次/前後移動/再読込の経路、モバイルの分岐/Editor操作、執筆ボタンが閲覧画面に出ないこと、本人編集/他者拒否/他者続話、競合と失敗時の入力・下書き保持を含む。公開環境の目次・本文のPC/375px画像はGit管理外 `deploy/.test/evidence/episodes-public/{toc,reader}-{desktop,mobile}.png`。

公開反映結果: 実装コミットed7799bで稼働、ローカル/公開Chromiumとも上記ブラウザ項目が成功。自動テスト27件成功。公開OAuth＋PKCE、MCP initialize/tools/list/tools/callと4ツール、作者/更新日時/編集後本文/経路、refresh、未認証/ロール不足/不正PKCE・resource、実時間期限切れ401と更新後の閲覧復帰を確認した。今回ChatGPT本体の操作は行っていない。管理経路は404、作品APIとMCPは未認証401。ログに秘密値・認可queryの検出なし。既存データの行比較も保持を確認。

専用検証アカウント3名は終了後に無効化・ログアウト・offline grant取消を行う。今回の検証作品1件/10話は記録として保持する。スクリーンショット4枚の固定コピーはローカル `/home/koji/novel-ui-screenshots/20261101/` に保存。実スマートフォン端末とローカルDockerの全スタックは未実行で、実Chromiumの375px表示および公開VPSで検証した。

## Main・別案件数・ホーム表示（schema v4、2026-11-01）

反映前の両DBバックアップ: `/home/ubuntu/novel-backups/20261101T041602Z`（cea285c）。このSQLiteコピーでv4へ移行し、元の全列/行、作者、本文、グッド、OIDC対応、全branch経路、FK/integrityを確認した。既存の最初の本編をstories.main_branch_idに記録し、既存/新規のhidden_from_homeは0（通常表示）。branch ID/名称/headや話の親子関係は書き換えない。

デフォルトはMain、以後はURLのbranchに沿って前後移動する。別branchへ自動延長しない。全branchの読書経路selectから明示的に切り替えられ、共通の話でも選択を保つ。別案アイコンは同じ親の話から自分を除いた数を常に表示し、0は開閉不可、1件以上は候補を開く。候補タイトルからそのbranchの本文へ進む。前後リンクは「前の話」「次の話」。本文専用の青い配色上書きを除き、紙色/緑の共通変数を使う。読書幅/本文サイズ/行間は維持する。

作品の最初の制作者は本文のEditor内「ホーム一覧ではデフォルト非表示」で切り替える。PATCH /api/stories/:idのhiddenFromHome真偽値をサーバーでもauthor_idと照合し、他者403、未認証401。Web一覧はview=allだけ非表示作品を含む。検索/並べ替え/LIMIT/OFFSETの前に条件を適用し、URLのq/sort/view/offsetで維持する。MCP list_storiesは明示的に全件を対象とし、作品/本文/経路取得、既存のアクセス制御、編集・投稿権限も変更しない。

検証はnpm test（29件）、既存ブラウザスクリプトのlocal/publicモード。Mainの固定、末尾の先の分岐への明示切替、共通部分の経路/前後/再読込、他作者の普通の続話、件数0/1/2、配色とEditor、表示設定の往復/他者拒否/通常とすべて、PC/375pxの検索・新着/人気・前後ページ、直接URL、既存編集・競合・下書き・失敗時保持を検証する。ページ送り専用14作品は専用ユーザーで作り、終了時にすべてデフォルト非表示へ設定して記録として残す。通常一覧の既存作品は勝手に非表示にしない。検証用3アカウントは最後に無効化・ログアウト・MCP offline grant取消を行う。

v4からの取り消しもDB移行を伴うため、両DBとバックアップ内commitを同時点の組で未使用volumeへ復元する。現状も事前バックアップし、復元時点以降の投稿/編集/表示設定が戻る範囲を確認する。既存volumeを削除・初期化しない。

公開環境の結果: 実Chromiumの全項目が成功。移行直後は全行・全列・Main・通常表示の設定がバックアップで試したv4と一致し、ブラウザ検証後にも全既存レコードが保持されることを確認した。非表示作品を含むMCP全4ツールとOAuth/PKCE・refreshも成功した。ホームのフォント依存記号は「経路」の文字に変更し、Editorチェック欄のaccentと読書経路selectの選択色も緑へ統一した。

専用検証作品は1件11話＋ページ送り用14件14話をすべてデフォルト非表示で保持する（削除なし）。既存の作品は通常表示のまま。ホーム（すべて/検証作品で検索）、Mainの目次と本文のPC/375pxの固定画像は `/home/koji/novel-ui-screenshots/20261101-main/{home,toc,reader}-{desktop,mobile}.png`。スクリーンショットは認証画面や秘密値を含まない。

最終結果: 公開MCPの実時間期限切れ401とrefresh後の復帰も成功。専用3アカウントは無効化・ログアウトし、novel-chatgptのoffline grantを取り消した。移行後の両DB最終バックアップは `/home/ubuntu/novel-backups/20261101T042557Z`（d7a175f）。v4 DB・秘密値・Caddy設定・対応コードを組で保存する。kojiのプロフィール・パスワード・ロール・同意には変更を加えていない。

今回は実ChromiumのPC/375pxと公開VPSで検証し、実スマートフォン端末・ローカルDocker全スタック・ChatGPT本体の再登録/会話操作は未実施。ChatGPT本体で以前に作品一覧取得できたことは利用者報告であり、今回のOAuth/MCP検証は独立したブラウザテストクライアントで行った。OAuth登録値やscopeは変更しておらず、ChatGPT側の再登録は不要。

## 作品情報・設定メモと参加者作成（schema v5、2026-11-01）

反映前バックアップ: `/home/ubuntu/novel-backups/20261101T044732Z`（7bfd20f）。SQLiteコピーで追加移行し、全既存列/行・Main・表示設定の保持、空メモ、作品revision=1、FK/integrityを確認した。storiesにsetting_notes（初期値空）、revision、updated_atを追加する。既存作品の本文・作者・親・票は変更しない。

目次上部の「作品情報」から `#info/作品ID?branch=選択ID` へ移動する。参加者は作品タイトル・あらすじ・最初の制作者・表示設定・設定メモを閲覧でき、最初の制作者のみ「編集」からまとめて変更する。作品全体の表示設定は各話Editorから移した。話のEditorは話の編集/続話/別案/分岐に限定する。目次へ戻るリンクはbranchを維持する。

PATCH /api/stories/:idはtitle/summary/hiddenFromHome/settingNotesの部分更新とexpectedRevisionを受け付ける。全設定を同じ作品revisionで競合検出し、古い更新409、他者403、未認証401。旧UIや旧APIクライアントのrevisionなし更新は400になり、最新版を再読込する必要がある。メモは100000文字まで、空文字と改行・前後の空白を保持し、表示はHTMLとして解釈しない。フォームと下書きに元のrevisionを保持し、保存失敗や再読込でも入力を復元する。最新情報からやり直す操作は下書き破棄の明示確認を伴う。

MCP get_storyはsetting_notes/revision/updated_atを返す。MCPに書き込みツールは追加していない。ホーム一覧API/MCP list_storiesの概要に長文メモは載せず、通常の目次・本文にも表示しない。

### パスワードを表示せず参加者を作る

```bash
python3 scripts/public-create-participant.py --username yui --display-name yui \
  --initial-password-file /home/ubuntu/.local/share/novel-onboarding/yui.initial-password
```

Keycloak内部APIでnovel-branchesの同名ユーザーを先に確認する。既存なら公開可能な状態だけを表示して終了し、パスワード・プロフィール・ロールや既存ファイルを変更しない。新規ならランダムな初回パスワードを0700ディレクトリ配下の0600ファイルへ排他的に保存し、enabled/novel-member/UPDATE_PASSWORDで作成する。秘密値は引数・標準出力・Gitへ載せない。ファイルやアカウント作成途中の失敗時は、状態を確認してから再試行する。本人の初回ログインを代行しない。

管理者が自分の端末で `ssh -t ubuntu@eletim.jp 'cat /home/ubuntu/.local/share/novel-onboarding/yui.initial-password'` を実行すると初回パスワードを確認できる。録画・ログ保存のない端末で確認し、本人へ別の安全な経路で連絡する。初回URLは `https://eletim.jp/novel/auth/login`。yuiで入り、本人がパスワード変更と要求された必須プロフィール入力を行う。変更確認後、`ssh ubuntu@eletim.jp 'rm -- /home/ubuntu/.local/share/novel-onboarding/yui.initial-password'` で一時ファイルを削除する。初回パスワードはチャットへ貼らない。

公開結果: 自動テスト32件成功。公開実Chromiumで作品情報への導線、作者限定フォーム/他者API403、タイトル/あらすじ/表示設定/長い日本語メモ/改行/空欄の保存・再読込、409と503時の入力・下書き保持と復元、モバイル編集、選択branchへの目次復帰、各話Editorから作品設定が外れたことを確認した。従来の読書/分岐/投稿/編集/競合/ホーム検索・並べ替え・ページ送りも成功。全既存レコードは移行直後/検証後のDB比較で保持を確認した。OAuth/MCPのget_storyは保存した設定メモと作品revisionを返し、4ツール・署名/role/scope検証・refreshも成功。

yuiは新規作成済み。表示名yui、有効、novel-member、UPDATE_PASSWORD、保存先 `/home/ubuntu/.local/share/novel-onboarding/yui.initial-password` が0600、親0700/所有者ubuntuを確認した。再実行は「既存アカウント保持」で終了し、パスワードをリセットしない。本人のログイン/初回変更は残している。初回パスワードファイルはGitや通常の公開バックアップ対象に含めていない。

実時間のMCPアクセストークン期限後の拒否とrefreshによる復帰も成功した。今回は独立したOAuthブラウザクライアントで検証しており、ChatGPT本体の再接続操作、実スマートフォン端末、ローカルDocker全構成は未実施。yui本人の初回ログインとパスワード変更も代行していない。

最終両DBバックアップ: `/home/ubuntu/novel-backups/20261101T045842Z`（2232980、最終結果の文書追記前）。v5の設定メモ・作品revision、yuiのKeycloakアカウント・初回変更必須状態、既存ユーザー・秘密値・対応コードを組で保存した。検証用3名は無効化/ログアウト/専用クライアントoffline grant取消済み。今回の検証作品15件はデフォルト非表示で保持し、既存作品や各話を削除していない。yuiは検証アカウントに含めず、有効のまま維持する。

## 作品ごとの複数管理者（schema v6、2026-11-01）

変更前バックアップ: `/home/ubuntu/novel-backups/20261101T064953Z`（ffeafbf）。既存37作品を含むSQLiteコピーでv6を試し、元の全行・全列・Main・表示設定・メモ・作者・本文・分岐・票・OIDC対応の保持とFK/integrityを確認した。story_managers(story_id,user_id)の複合主キーを追加し、全作品の最初の制作者を登録する。新作も作成トランザクションで制作者を管理者にする。権限を追加してもstories.author_idは変えない。最初の制作者の権限は解除不可で、元の作者判定も残す。

作品情報の4項目（タイトル/あらすじ/通常・非表示/設定メモ）は作品管理者が編集できる。WebのGET /api/stories/:idはログイン中ユーザーのcan_manageを返し、作品情報の編集ボタンはこの値で出す。PATCHは毎回DBの権限を確認し、解除済みの古いフォームも403にする。CAS/下書き/保存失敗時保持は維持する。各話の編集は引き続き各話author_idのみで、作品管理権限は参照しない。管理者設定用HTTP/MCPエンドポイントやWeb UIは設けない。閲覧専用MCPは従来4ツールのみ。

### 管理者の追加・解除・確認

VPSの `/home/ubuntu/novel_branches` で実行する。作品IDは作品URLの `#story/42` / `#info/42` などの数字。--usernameは表示名ではなく**Keycloakの正確なログインID**。

```bash
python3 scripts/public-story-managers.py grant --story 42 --username koji
python3 scripts/public-story-managers.py revoke --story 42 --username koji
python3 scripts/public-story-managers.py list --story 42
python3 scripts/public-story-managers.py audit --username koji
# 明示的に、実行時点に存在する全作品（非表示を含む）だけへ一括付与
python3 scripts/public-story-managers.py grant --all-existing --username koji
```

追加・解除は内部Docker CLIで行う。Keycloak管理APIで同じrealmの正確なusernameを一意に取得し、Keycloakのuser ID（OIDC sub）とアプリに設定されたissuerの組でoidc_identitiesを照合する。表示名/メールでは判定せず、Keycloakやアプリのユーザーを作成・統合しない。付与は有効なnovel-memberに限定する。対応が未作成なら本人の初回ログイン状態を確認し、誤ったユーザーへ代替割当しない。既存のパスワード・プロフィール・ロール・同意は変更しない。

listは内部ユーザーID・username・表示名・creatorを表示する（OIDC利用者の内部usernameは不透明な識別子）。audit/grant/revokeはKeycloak username/issuer/sub/内部userIdを出すので本人対応を確認できる。auditのtotalとmanagedで全件を確認し、一括付与のaddedは新規追加数。同じ付与の再実行はadded=0となる。最初の制作者をrevokeすると失敗し、その権限は残る。一括付与を定期実行・起動処理へ登録しない。今後の新作へkojiを自動追加しない。
