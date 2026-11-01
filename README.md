# みんなで小説を作ろう — Novel Branches

任意の話の読了地点から別の続きを書き、平行世界のように物語を広げる小説サイト。まずは2〜3人の共同利用向け。作品と全分岐を保存し、各話のグッドで面白い展開を見つけられます。

公開サイト: **https://eletim.jp/novel/**（参加者ログイン必須）。VPS運用は [docs/eletim-vps.md](docs/eletim-vps.md)。

## できること

- 公開用はKeycloakでログイン、ローカル開発用はCLIで作ったアカウントでログイン
- 新作と第一話を投稿、参加者なら他の作者の経路にも続話・同じ話数の別案を投稿
- 誰でも任意の話から分岐し、分岐からさらに分岐
- 共通の話を複製せず参照し、分岐ごとの読む順番と親子関係を表示
- 各話へのグッド（1人1票、取消可能）、作品のグッド順・新着順・検索・ページ送り
- 下書きをブラウザ内に自動保存（ユーザー・投稿先ごと）
- 同じSQLiteデータを読む閲覧専用MCP：Streamable HTTPとstdio

既存Tailscale内で利用する場合は [VPN起動手順](docs/vpn.md) を参照してください。

## Keycloak・Nginxを含むローカル起動

継続利用するlocalhost専用環境は [docs/local-validation.md](docs/local-validation.md) を参照してください。`npm run local -- up` でHTTPS・Keycloak・DBを起動し、設定とデータを再利用します。

## ローカル起動

Node.js 24以上。依存パッケージをインストールして起動します。ビルドは不要です。

公開サーバー用のKeycloak × Nginx構成は [docs/public-server.md](docs/public-server.md) を参照してください。以下はローカル開発用です。

```bash
git clone https://github.com/eletim/novel_branches.git
cd novel_branches
npm ci

# アカウントごとに実施。パスワードは10文字以上。
# Bashで履歴に残さず入力し、標準入力へ渡す。
read -rs -p 'Password: ' novel_password; echo
printf '%s' "$novel_password" | npm run user -- add alice アリス
unset novel_password

# 任意：オリジナルと分岐があるサンプル作品を追加（作品がないDBのみ）
npm run demo

npm start
```

http://localhost:3000 でログインします。サンプル作者はログインできないランダムパスワードで作られます。自分の作品は自分のアカウントから投稿してください。

## Dockerで起動

```bash
docker compose up -d --build
read -rs -p 'Password: ' novel_password; echo
printf '%s' "$novel_password" | docker compose exec -T app node scripts/user.mjs add alice アリス
unset novel_password
# 必要ならサンプル作品を追加
docker compose exec app node scripts/demo.mjs
```

このComposeはローカル開発専用です。公開用には単独の `deploy/compose.public.yaml` を使います。

データは名前付きvolume `novel-data` に保存します。ホストの公開先は127.0.0.1:3000です。2〜3人で共有する場合は、この前段にHTTPSのリバースプロキシ等を置き、下記の `APP_ORIGIN` と `COOKIE_SECURE` を合わせてください。公開サイトの運用構成は [docs/eletim-vps.md](docs/eletim-vps.md) を参照してください。

## 設定

Node起動時は環境変数で指定します。Docker Composeでは同名の変数を `.env` または起動環境に設定できます。`.env` はGitに含めません。Nodeでファイルを使う場合は `node --env-file=.env src/server.mjs` を利用してください（`npm start` は `.env` を自動読込しません）。

| 変数 | 既定値 | 用途 |
|---|---|---|
| `HOST` | `127.0.0.1` | Nodeの待受先。Docker内は`0.0.0.0` |
| `PORT` | `3000` | Nodeのポート |
| `DB_PATH` | `./data/novels.db` | SQLiteファイル。Docker内は`/app/data/novels.db` |
| `APP_ORIGIN` | リクエストのHTTP Host | ブラウザの接続元。共有時は実URL、例`https://novels.example.com` |
| `COOKIE_SECURE` | `false` | HTTPS運用時は`true` |
| `MCP_TOKEN` | 未設定 | HTTP MCP用の共有閲覧トークン。未設定ならHTTP MCPは利用不可 |

Webの作品本文と一覧はログイン必須です。ローカル開発用のセッションは7日で失効し、HTTP MCPは共有Bearerトークンを使います。公開用ではKeycloakへ切り替え、共有トークンとローカルログインを無効にします。

## MCP接続

詳しい設定は [docs/mcp.md](docs/mcp.md)。公開用の認証設定は [docs/public-server.md](docs/public-server.md) を参照してください。提供ツールは以下の4つです。

| ツール | 内容 |
|---|---|
| `list_stories` | 検索・並び替え・ページ指定した作品一覧 |
| `get_story` | 作品、全分岐、話の親子関係 |
| `get_chapter` | 本文、その話の制作者・最終更新日時・revision、グッド、分岐先・次の話 |
| `get_branch_path` | 分岐前の共通話も含む読書順 |

## 開発・検証

```bash
npm test
npm run dev
```

テストは一時DBと署名付きのテスト用OIDCプロバイダーを使い、分岐と入れ子の読書順、所有権、投稿競合、1人1票、保存、セッション、2人でのHTTP操作、HTTP MCP、stdioのJSON-RPCを確認します。GitHub ActionsでもNode 24で実行します。

## この初期版の範囲

- 投稿済みの話のタイトル・本文はその話の制作者だけが編集できます。共通の話の編集は参照する全経路へ反映されます。revisionで古い編集の上書きを防ぎます。削除は未実装です。
- グッド順は作品内の各話の票を合計します。低評価の作品・話も保存され、閲覧できます。自動的な削除・非表示は行いません。
- 公開登録、メール送信、コメント、AIによる執筆・変更、アプリ独自のパスワード再設定UIは未実装です。
- HTTP MCPはBearer認証です（公開用はKeycloakのアクセストークン）。接続先クライアントがその認証方法を扱える必要があります。ChatGPTへの実接続は別途確認が必要です。公開配置は実施済みです。
- 単一プロセスとSQLiteの構成です。データを持つサーバーで起動してください。

設計は [docs/architecture.md](docs/architecture.md)、作業状態は [docs/status.md](docs/status.md)。

作品を開くとMainを表示し、前後移動は選択したブランチの順序を保ちます。別案アイコンは現在の話を除いた件数です。最初の制作者は本文のEditorからホーム一覧での表示設定を変更できます。ホームの「通常／すべて」は検索・並べ替え・ページ送りにも適用し、直接URLとMCPの閲覧範囲は変わりません。

目次上部の「作品情報」で作品全体の情報と設定メモを読めます。最初の制作者だけが編集でき、表示設定もこのページに集約しています。作品情報は版番号で競合を検出し、失敗時の入力と下書きを保持します。

作品の最初の制作者に加え、内部CLIで割り当てた作品管理者も作品情報と設定メモを編集できます。権限の追加・解除・確認は [VPS運用手順](docs/eletim-vps.md#作品ごとの複数管理者schema-v62026-11-01) を参照してください。各話の編集はその話の制作者だけです。
