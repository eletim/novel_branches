# localhost導入と実操作検証

## 起動とアカウント

2026-10-27、Ubuntu 22.04 / Docker Compose 2.32.1 / Node.js 24.22.1 / Google Chrome 131で検証。PR #1は未マージ、mainは77b232f。未コミット変更がないことを確認して、PRブランチ `feat/keycloak-nginx` の18291a3を基準に作業した。

```bash
cd /home/eletim/novel/novel_branches
source "$HOME/.nvm/nvm.sh"
nvm use 24
npm ci
npm run local -- up       # 初回生成、以後は設定・DBを再利用。ビルドも実行
npm run local -- status
npm run local -- stop     # コンテナとvolumeを保持
npm run local -- up       # 停止後の起動
npm run local -- restart  # 全サービス再起動、HTTPS discoveryの復帰を待つ
```

URLは **https://localhost:8443**。http://localhost:8088 はHTTPSへ転送。両ポートとも127.0.0.1限定。既存の80/443/8080、既存コンテナ・volume・VPN設定は変更していない。プロジェクトは `novel-branches-local`、volumeは `novel-branches-local_novel-data`（SQLite）と `novel-branches-local_keycloak-data`（PostgreSQL）。Nginx以外にホスト公開ポートはない。app/auth/dbネットワークはinternal。

| ユーザー | 用途 | パスワードのキー |
|---|---|---|
| test-member | 参加者A | TEST_MEMBER_PASSWORD |
| test-other | 参加者B | TEST_OTHER_PASSWORD |
| test-outsider | 権限なし・拒否検証 | TEST_OUTSIDER_PASSWORD |

秘密値はGit管理外の `deploy/.test/stack.env`（0600）に保管。親ディレクトリは0700。ローカルエディタで開き、上記キーの値をログイン画面へ入力する。ターミナルやチャットに出力しない。`test-realm.json` にも初期ユーザーのパスワードが含まれる。コンテナ内Keycloakから読める0644だが親ディレクトリで他ユーザーから隔離。管理者はtest-admin、秘密値は同ファイルのKC_ADMIN_PASSWORD。管理UIは利用者経路から公開していない。

設定ファイル・秘密鍵を削除しない。既存realmは再インポートで更新されない。設定を失った場合はバックアップから復元し、volumeを初期化して合わせない。通常停止で `down -v` を使わない。証明書は生成日から365日有効。期限前にlocalhost証明書を更新してブラウザへ再登録し、Nginxを再起動する必要がある（自動更新なし）。

## 証明書

このPCのユーザー用Chrome NSS DBへ `deploy/.test/tls/fullchain.pem` を `novel-branches-local` という名前で信頼登録済み。TLS検証を無効にする引数・ignoreHTTPSErrors・curl -kは使っていない。Chromeが起動済みなら再起動して開く。他のPCやFirefoxにはこの信頼設定は引き継がれない。

別環境でのChrome登録例（certutilはlibnss3-tools）：

```bash
mkdir -p "$HOME/.pki/nssdb"
# 新しいDBの場合だけ: certutil -N --empty-password -d "sql:$HOME/.pki/nssdb"
certutil -A -d "sql:$HOME/.pki/nssdb" -n novel-branches-local \
  -t 'C,,' -i deploy/.test/tls/fullchain.pem
curl --cacert deploy/.test/tls/fullchain.pem https://localhost:8443/
```

このPCではsudo不要の展開済みcertutilを `/tmp/novel-nss/usr/bin/certutil` から使用した。信頼登録自体はホームディレクトリに永続化されている。

## 再現用検証コマンド

```bash
npm test
NODE_EXTRA_CA_CERTS="$PWD/deploy/.test/tls/fullchain.pem" npm run test:stack
npm run test:browser
NODE_EXTRA_CA_CERTS="$PWD/deploy/.test/tls/fullchain.pem" node scripts/test-mcp-local.mjs
NODE_EXTRA_CA_CERTS="$PWD/deploy/.test/tls/fullchain.pem" npm run test:expiry
npm run local -- restart
NODE_EXTRA_CA_CERTS="$PWD/deploy/.test/tls/fullchain.pem" node scripts/test-mcp-local.mjs --compare
```

ブラウザはPlaywrightから実Chromeを操作する。既定パスは `/usr/bin/google-chrome`、別の実行ファイルはCHROME_PATHで指定。認証情報を含むtrace/HARは採取しない。`test:browser` は毎回新しい作品を投稿し、過去データは消さない。MCP検証はその最新の作品を参照する。`--compare` の前にbrowser検証を再実行しないこと。証跡はGit管理外の `deploy/.test/evidence/` に保存する。

`test:expiry` は約5分、実時間でトークン・cookieの期限を待つ。MCPのローカル検証用realmのみパスワードgrantを使用する。wrong audience検証は内部管理APIで一時クライアントを作成し、トークン取得後に削除する。配布realmの認証設定は変更しない。

## 問題と再確認

- **再準備で秘密値が変わる**：準備スクリプトを再実行すると保存済みrealmとクライアントsecret・パスワードが不一致になる。既存ファイルを再利用、不完全なら停止するよう変更。ファイル内容が再実行前後で完全一致する回帰テストを追加。継続環境のvolumeがあるのに設定を失った場合も起動ラッパーが拒否する。
- **分岐を最初から読むと選択が消える**：Bの世界の「最初から読む」で共通話へ移動するとURLが `#chapter/ID` だけになり、分岐を選び直す必要があった。分岐IDを保持し、共通部分と選んだ経路の次話を表示する。変更前にブラウザ回帰チェックが失敗、変更後に本編・B分岐・入れ子の順次読書が成功。
- **別タブのアカウント切り替えによる誤投稿**：画面のAとcookieのBが異なる状態で新作を送るとB名義になる構造だった。変更APIで画面のユーザーIDとセッションを照合。実ChromeでAの執筆中に別タブからBへ切り替え、409・本文保持・作品未作成を確認。ヘッダーだけでは認証できない。
- **執筆中の期限切れから復帰しづらい**：401後にモーダル内から再ログインできなかった。本文を残して再ログインリンクを表示し、下書き復元を可能にした。再送時に未ログイン状態で送信しない。ストレージ保存が無効な環境もあるため、リンクでは本文を控える案内を表示。
- CIで検索結果の描画前に件数を検査する待機不足を検出。検索応答後に描画を待つようブラウザ検証を修正。
- テストの秘密値をDockerビルドコンテキストへ送らないよう `.dockerignore` にも追加。

## 検証範囲

- 単体・HTTP・署名付きOIDC・stdio・設定再利用の自動テスト20件成功。
- 実Keycloak/Nginx：参加者2名のログイン、権限なしユーザーの403、ログアウト・再ログイン、他人の分岐への403、HTTPS転送、非公開管理経路。
- Chrome：新作→本編続話→B分岐→B続話→入れ子分岐、各経路の順次読書、グッド追加/取消/重複抑止、検索・新着/グッド順、目次・戻る/進む・再読み込み・直接アクセス・存在しない話から復帰。
- Chrome：下書きの再読み込み復元、別タブ先行投稿による409と本文保持、503を注入した投稿失敗と本文保持、同一ブラウザ内の別ユーザー切り替えによる誤投稿防止。
- PC1280pxとスマホ375px：本文16px、line-height28.8px（1.8）、PC本文幅600px、背景rgb(237,247,255)、横あふれなし。一覧・ログインでは読書背景が解除。CSSはメイリオ優先だが実描画は **Noto Sans CJK JP**（Chrome DevToolsのplatform fontsで確認）。PC/スマホのスクリーンショットも目視確認。
- HTTP MCP検証クライアント：initializeと4つの読み取りツール、ブラウザ投稿の本文・分岐順・グッドを照合。未認証・共有文字列・異なるaudience・参加ロールなし・scopeなしを実Keycloakトークンで拒否。書き込みツールは存在せず呼び出し拒否。
- 全4サービスの再起動後、MCPで作品全体・入れ子の経路・本文・評価を再起動前のJSONと完全一致で照合。実Keycloakの2ユーザー操作も再実行して成功。
- 約5分の実時間経過後、実Keycloak MCPトークンの401と、ブラウザ投稿の期限切れ→本文保持→SSO再認証→下書き復元が成功。
- Compose設定と実コンテナのポート、内部ネットワーク、ログ中にテスト秘密値・認証queryがないことを検査。

ChatGPTからの実接続・外部公開・DNS変更・本番配置・mainへのマージは実施しない。stdioは自動テストの一時DBで確認し、常設DBへのstdioクライアント接続は未実施。Firefox・実スマホ端末・メイリオ実描画は未確認。登録、投稿済み本文の編集/削除、MCP OAuth自動発見は既存の未実装範囲。
