# 作業状態 — v0.2.0

## 実装済み

- 投稿、続話、任意の話からの分岐、入れ子の分岐、読書順、グッド、検索、下書き、永続化。
- 公開用Keycloak認証（Authorization Code + PKCE）、state/nonce/署名/issuer/audience/期限/参加ロールの検証。
- ローカル用ログインと公開用OIDCの切り替え。公開用ではローカル認証・セッションを無効化。
- Secure / HttpOnly / SameSite / __Host-cookie、Originの検証、Keycloakログアウトと署名付きbackchannel logout。
- 公開用MCPのKeycloakアクセストークン検証（署名・issuer・audience・scope・参加ロール）。
- Nginxだけを外部公開する独立Compose、Keycloak用PostgreSQL、HTTPS・管理経路の非公開化。
- 旧DBからの追加型移行、起動手順、CI、使い捨てlocalhostスタックの統合テスト。

## 検証

ローカルの `npm test` は19件成功。`npm audit --omit=dev --audit-level=high` は脆弱性0件。

認証テストは実際の `openid-client` / `jose` とテスト用署名鍵・HTTP OIDCプロバイダーを使い、正常系と不正な認証情報の拒否を検証しています。公開issuerを保った内部接続への転送も確認しました。

Dockerを利用できるGitHub Actionsでは、Keycloak・PostgreSQL・Nginx・アプリをlocalhost上に起動する `keycloak-nginx` ジョブを追加しています。最終結果はPRのCIを確認してください。通常テストとこのジョブは別です。

公開配置は完了（下記eletim.jp参照）。DNSは変更せず既存の正式証明書を再利用。

## 未実施

- 実際のChatGPT環境へのOAuth接続設定・登録・読書確認。
- ChatGPT側の接続登録と本人ログイン・実会話からの呼び出し。MCPの認証自動発見と事前登録OAuthクライアントは実装・配置済み。DCRは採用しない。
- 投稿済みの話の削除UI、一般公開向けの登録機能。

公開用設定は [public-server.md](public-server.md) を参照してください。

## localhost実操作検証（2026-10-27）

Keycloak・Nginx・PostgreSQL・アプリを専用の127.0.0.1環境に導入し、実ChromeとHTTP MCPクライアントで検証。分岐の読書経路保持、別タブのユーザー切り替えによる誤投稿防止、期限切れ時の再ログイン導線、秘密値を再生成しない起動手順を追加。自動テストは20件。起動、アカウント、実施範囲と未確認事項は [local-validation.md](local-validation.md) を参照。

## eletim.jpでのサブパス公開（2026-11-01）

`https://eletim.jp/novel/` へ配置・公開済み。配置先 `/home/ubuntu/novel_branches`、ブランチ `deploy/eletim-public`。CaddyのTLS自動更新を利用し、Keycloak issuer `/id/realms/novel-branches` を維持したままcallback/logout/backchannelを `/novel/` に対応。静的ファイル・API・画面リンクもサブパス対応。既存の作品・ユーザー・作者ID・秘密値・volumeを保持し、mainにはマージしていない。

自動テスト21件成功。外部から実Chromiumで参加者2名のログイン・ログアウト、新作・続話・分岐・入れ子・読書順・グッド・下書き・競合・別ユーザー誤投稿防止・PC/スマホ表示・パス保持・参加ロールなし拒否を確認。管理経路・master realm・healthは404、未ログイン作品APIは401。ログに秘密値・認可コードの混入なし。

ntfy 2.27.0は実機でサブパスを拒否したため、ユーザー承認に基づき全設定・データをバックアップして停止。`/ntfy/` は410。Caddyは小説用に継続使用。詳細、アカウント追加、更新、両DBのバックアップ・復元は [eletim-vps.md](eletim-vps.md) を参照。

公開後は約5分の実時間経過後のセッション期限も確認し、失敗した投稿の本文保持、Keycloak SSOによる `/novel/` への再ログイン、下書き復元、ログアウトが成功した。検証用3アカウントは再び無効化・セッション失効し、検証作品は保持した。

## ChatGPT向けMCP OAuth（2026-11-01）

Protected Resource Metadataと401の `WWW-Authenticate` / OAuth tool metadata、RFC 8414の認可サーバーメタデータを追加。VPSのKeycloak 26.8.1でResource Indicatorsを有効化し、専用の `novel-chatgpt` confidentialクライアントを事前登録した。認可コード・PKCE S256・同意画面・通常refresh token、canonical resource/audience `https://eletim.jp/novel/mcp` を使用する。署名・issuer・期限・参加ロール・read scopeを維持し、4つの閲覧ツールのみ。管理・DCR経路は非公開。

自動テスト22件成功。外部の実ブラウザを使ったOAuthクライアントでコード交換・issuer識別、initialize、4ツール、refresh、匿名/不正トークン/ロールなし/scopeなし/不正PKCE/コード再利用/不正resourceの拒否を確認。既存Webのログイン・閲覧・投稿・分岐・グッド等の回帰検証も成功。詳細は [mcp.md](mcp.md)。ChatGPT本体の登録画面はこの作業環境から操作できないため、**ChatGPTからの実接続は未確認**。登録・本人認証後の会話テストは利用者側で必要。

実時間約5分待ってMCPアクセストークン期限後の本文取得401と、refresh tokenによる復帰も確認した。終了後は検証用3アカウントを無効化・ログアウトし、変更後の秘密値・認証設定を含む両DBバックアップを取得済み。

## ChatGPT invalid_scope対応（2026-11-01）

`openid offline_access` のinvalid_scopeを再現し、専用クライアントのoffline scope/role mapping不足を修正した。`novels:read` はdefault scopeとして同意後のトークンに含め、MCP側の必須権限検証を維持する。Keycloak offline refresh時にURL audienceが失われる挙動も確認し、独立した固定URL Audience mapperで更新後もURL audienceを保つ。ユーザー・作品・secret・callbackは維持。署名付きscope組み合わせテストを追加して自動テスト23件成功。

外部実ブラウザで `openid offline_access` と3scopeの認可成功、offline token発行、4ツール、通常の即時更新と実時間の期限切れ後のoffline更新を確認した。更新後のJWTにもURL audienceを要求し、権限不足の拒否を維持。既存Webの回帰検証成功。検証アカウントとそのoffline grantは無効化し、変更後バックアップを取得済み。ChatGPT本体での認証は利用者の再試行待ち。

## 目次・共同投稿・編集（2026-11-01）

通常の縦目次、話ごとの制作者・更新日時、同じ親に属するbranch候補、第一話の別案・途中・入れ子と経路保持を実装。参加者の共同続話、本人限定のタイトル・本文編集、revision競合検出と下書き保持を追加。SQLite v3は既存データへの追加移行。MCPは既存4ツールのまま各話の制作者・更新日時・revisionと編集後本文を返す。

利用者よりChatGPT本体からMCPの作品一覧取得成功の報告あり。今回のサーバー検証は独立したOAuthクライアントで行い、ChatGPTの会話操作を代理実行したものではない。
