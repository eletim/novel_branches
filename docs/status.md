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

## 未実施

- ユーザーの公開サーバーへの配置、DNSや実証明書の設定（依頼により実施しない）。
- 実際のChatGPT環境へのOAuth接続設定・登録・読書確認。
- 公開用MCPのOAuth自動発見・動的クライアント登録（現在はBearerトークン検証まで）。
- 投稿済み本文の編集/削除UI、一般公開向けの登録機能。

公開用設定は [public-server.md](public-server.md) を参照してください。
