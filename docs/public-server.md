# 公開サーバー用構成 — Keycloak × Nginx

この変更では実環境への配置・DNS変更・証明書取得は行っていません。以下は配置時と隔離テスト用の手順です。

## 構成

インターネット → NginxのHTTPS入口 → 小説アプリ / Keycloakのログイン用エンドポイント。

- 小説アプリはSQLiteを専用volumeに保存します。
- Keycloakは専用PostgreSQLにユーザー・パスワード・認証設定を保存します。
- 外部公開ポートはNginxの80/443のみです。アプリ、Keycloak、両DBにホストの公開ポートはありません。
- 内部通信は同一ホスト上のDocker内部ネットワークを使います。自宅VPNへの接続は必要ありません。
- Nginxは `/id/realms/novel-branches/` とログイン用静的ファイルをKeycloakへ転送します。`/id/admin/`、master realm、health/metricsは外部へ転送しません。

## 公開用ファイル

| ファイル | 内容 |
|---|---|
| `deploy/compose.public.yaml` | 公開用の独立したCompose構成 |
| `deploy/nginx/default.conf.template` | HTTPS、HTTPリダイレクト、ヘッダー上書き、経路制限 |
| `deploy/keycloak/novel-branches-realm.json` | realm、参加ロール、Web/MCPクライアント |
| `deploy/.env.example` | ドメイン・証明書・秘密値の設定例 |

公開用Composeは**単独で**使用します。開発用 `compose.yaml` と `-f` で重ねません。開発用のポートや認証設定を引き継がせないためです。

## 配置時に用意する設定

`deploy/.env.example` を `deploy/.env` にコピーし、以下を設定します。秘密値はGitに保存しません。

- `PUBLIC_HOST`: ドメインのみ、例 `novels.example.com`
- `APP_ORIGIN`: 実際のHTTPS URL、例 `https://novels.example.com`。末尾の `/` は付けません。
- `TLS_DIR`: `fullchain.pem` と `privkey.pem` がある絶対パス
- `OIDC_CLIENT_SECRET`, `KC_DB_PASSWORD`, `KC_ADMIN_PASSWORD`: それぞれ独立した32文字以上のランダム値
- `HTTP_PORT`, `HTTPS_PORT`: 通常は80と443。テストで異なるポートを使う場合、`APP_ORIGIN` にもHTTPSポートを含めます。

Nginxのテンプレートには環境変数を展開します。ドメインとURLは管理者が設定する値であり、リクエストのHostや転送ヘッダーから認証URLを組み立てません。

配置時の構文確認・起動コマンド：

```bash
docker compose --env-file deploy/.env -f deploy/compose.public.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.public.yaml up -d --build
```

本変更ではこれらを実環境で実行していません。既存のNginxが80/443を使用しているサーバーでは、そのNginxとの接続方法を配置時に合わせます。

## ユーザーの追加

公開用のパスワードとユーザーはKeycloakで管理します。自己登録は無効です。参加者にrealm role `novel-member` を付与します。このロールがないユーザーはログインに成功しても小説アプリへ入れません。

管理用エンドポイントを公開せず、サーバーへのSSHとコンテナ内のKeycloak管理CLIを使えます。例：

```bash
docker compose --env-file deploy/.env -f deploy/compose.public.yaml exec keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials \
  --config /tmp/novel-admin.config \
  --server http://localhost:8080/id --realm master --user admin
```

パスワードはCLIのプロンプトで入力します。続けて同じ `--config /tmp/novel-admin.config` を指定してユーザー作成・ロール付与・初回パスワード設定を行います。管理UIを使う場合の管理者専用経路は、この構成には追加していません。

Keycloakのrealm JSONは**初回インポート用**です。既存realmがある場合、再起動で設定を上書きしません。秘密値を変更した場合は、Keycloakクライアント側の秘密値とアプリ側を揃えて変更します。

## 認証フロー

1. ブラウザが `/auth/login` を開く。
2. サーバー側に10分有効なstate・nonce・PKCE verifierとブラウザ確認情報を保存する。
3. Keycloakでログインし、`/auth/callback` に戻る。
4. `openid-client` がコード交換、署名、issuer、audience、期限、nonce、stateを検証する。
5. 参加ロールを確認し、`issuer + sub` で作者を識別する。メールや表示名で既存ユーザーと自動統合しない。
6. ブラウザにはランダムなセッションcookieのみを渡す。認証トークンをlocalStorageへ保存しない。

HTTPS用cookieは `__Host-` 接頭辞、Secure、HttpOnly、SameSite=Lax、Path=/ を使用します。公開用では独自パスワードログインと旧ローカルセッションは無効です。変更APIはOrigin一致を必須にし、外から渡された認証ヘッダーをユーザー識別に使いません。

ブラウザのセッションはID tokenの期限か15分の短い方です（配布realmのトークン寿命は5分）。期限後はKeycloakで再認証します。KeycloakのSSOが有効なら通常はパスワード再入力なしで戻れます。ユーザー無効化やロール変更は遅くとも次の認証時に反映されます。

ログアウトはアプリのセッションを削除してKeycloakのRP-initiated logoutへ進みます。Keycloakの署名付きbackchannel logoutも受け付け、対応するアプリセッションを失効させます。Keycloakが応答しない場合もアプリ側のログアウトは行います。その場合、Keycloak側のSSOログアウトは完了していない可能性があります。

## MCP

公開用では共有文字列の `MCP_TOKEN` を受け付けません。Keycloak署名付きアクセストークンについて、issuer / audience `novel-mcp` / 有効期限 / `novel-member` ロール / `novels:read` scopeを検証します。MCPは閲覧専用です。

配布realmの `novel-mcp` はリダイレクト先未登録・認可コードフロー無効で用意しています。実際に接続するMCPクライアントが決まった時点で、**そのクライアントの正確なredirect URIだけ**を登録し、Standard FlowとPKCE S256を設定してください。ワイルドカード、パスワードgrant、匿名公開は使いません。

OAuth認可サーバーの自動発見（protected-resource metadata）や動的クライアント登録は未実装です。現在の公開用MCPは、設定済みのクライアントから渡されたBearerアクセストークンを検証するリソースサーバーです。ChatGPT側の実接続はまだ確認していません。アクセストークンの失効・ロール変更は最長5分のトークン期限まで反映に遅れます。

## 隔離された実スタックテスト

継続利用する場合は [ローカル導入・検証記録](local-validation.md) の `novel-branches-local` を使ってください。以下の `down -v` はCI等の使い捨てデータ専用です。準備スクリプトは既存ファイルを再利用し、不完全な設定では停止します。

DockerとCompose、Node.js 24、OpenSSLがある環境で実行します。本番ドメインも本番の秘密値も使いません。

```bash
npm ci
node scripts/prepare-stack-test.mjs

docker compose --project-name novel-branches-test \
  --env-file deploy/.test/stack.env -f deploy/compose.public.yaml config --quiet
docker compose --project-name novel-branches-test \
  --env-file deploy/.test/stack.env -f deploy/compose.public.yaml up -d --build

NODE_EXTRA_CA_CERTS="$PWD/deploy/.test/tls/fullchain.pem" npm run test:stack

docker compose --project-name novel-branches-test \
  --env-file deploy/.test/stack.env -f deploy/compose.public.yaml down -v --remove-orphans
```

localhost:8088/8443だけを使用します。生成した証明書をテストプロセスのCAに追加し、TLS検証を無効にしません。通常の `npm test` はこのスタックを起動せず、署名付きのテスト用OIDCプロバイダーで認証経路を検証します。GitHub Actionsには両方のテストを用意しています。

テスト用realmではMCPの実トークンを取得するためにパスワードgrantを有効にします。この変更はGit管理外の `deploy/.test/test-realm.json` のみに加え、配布するrealmでは無効のままです。

## 参照した公式資料

- https://www.keycloak.org/server/reverseproxy
- https://www.keycloak.org/server/hostname
- https://www.keycloak.org/server/importExport
- https://www.keycloak.org/securing-apps/oidc-layers
- https://github.com/panva/openid-client
- https://nginx.org/en/docs/http/ngx_http_proxy_module.html
