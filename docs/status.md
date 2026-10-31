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
- 公開用MCPのOAuth自動発見・動的クライアント登録（現在はBearerトークン検証まで）。
- 投稿済み本文の編集/削除UI、一般公開向けの登録機能。

公開用設定は [public-server.md](public-server.md) を参照してください。

## localhost実操作検証（2026-10-27）

Keycloak・Nginx・PostgreSQL・アプリを専用の127.0.0.1環境に導入し、実ChromeとHTTP MCPクライアントで検証。分岐の読書経路保持、別タブのユーザー切り替えによる誤投稿防止、期限切れ時の再ログイン導線、秘密値を再生成しない起動手順を追加。自動テストは20件。起動、アカウント、実施範囲と未確認事項は [local-validation.md](local-validation.md) を参照。

## eletim.jpでのサブパス公開（2026-11-01）

`https://eletim.jp/novel/` へ配置・公開済み。配置先 `/home/ubuntu/novel_branches`、ブランチ `deploy/eletim-public`。CaddyのTLS自動更新を利用し、Keycloak issuer `/id/realms/novel-branches` を維持したままcallback/logout/backchannelを `/novel/` に対応。静的ファイル・API・画面リンクもサブパス対応。既存の作品・ユーザー・作者ID・秘密値・volumeを保持し、mainにはマージしていない。

自動テスト21件成功。外部から実Chromiumで参加者2名のログイン・ログアウト、新作・続話・分岐・入れ子・読書順・グッド・下書き・競合・別ユーザー誤投稿防止・PC/スマホ表示・パス保持・参加ロールなし拒否を確認。管理経路・master realm・healthは404、未ログイン作品APIは401。ログに秘密値・認可コードの混入なし。

ntfy 2.27.0は実機でサブパスを拒否したため、ユーザー承認に基づき全設定・データをバックアップして停止。`/ntfy/` は410。Caddyは小説用に継続使用。詳細、アカウント追加、更新、両DBのバックアップ・復元は [eletim-vps.md](eletim-vps.md) を参照。

公開後は約5分の実時間経過後のセッション期限も確認し、失敗した投稿の本文保持、Keycloak SSOによる `/novel/` への再ログイン、下書き復元、ログアウトが成功した。検証用3アカウントは再び無効化・セッション失効し、検証作品は保持した。
