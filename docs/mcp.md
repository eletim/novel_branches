# 閲覧用MCP

以下の共有トークン設定はローカル開発用です。公開用はKeycloakのアクセストークンを検証します。[公開用の設定と接続範囲](public-server.md#mcp) を参照してください。

作品データを変更するツールは公開しません。Webと同じSQLiteを参照します。

## Streamable HTTP

`MCP_TOKEN` に十分長いランダム値を設定してサーバーを起動すると、`/mcp` が利用できます。トークンをGitに保存しないでください。HTTPSでリモート接続する場合は `APP_ORIGIN` も設定します。

クライアント設定例（キー名はクライアントによって異なります）：

```json
{
  "mcpServers": {
    "novel-branches": {
      "url": "https://YOUR-HOST/mcp",
      "headers": { "Authorization": "Bearer YOUR-MCP-TOKEN" }
    }
  }
}
```

通信確認：

```bash
curl http://localhost:3000/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0"}}}'
```

ステートレスのJSON応答を採用し、サーバー発のSSEは提供しません。通知には202、GETには405を返します。Originがある場合は `APP_ORIGIN` と照合します。

## stdio

ローカルMCPクライアントから起動する設定例。コマンドは `npm run mcp` ではなく **直接nodeを指定** します（npmの起動ログがプロトコルの標準出力に混ざるのを防ぐため）。

```json
{
  "mcpServers": {
    "novel-branches": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/novel_branches/src/stdio.mjs"],
      "env": { "DB_PATH": "/ABSOLUTE/PATH/novel_branches/data/novels.db" }
    }
  }
}
```

stdioは同じPCのファイル権限でDBを読みます。Webと必ず同じ `DB_PATH` を指定してください。WebがDocker内の場合はHTTP接続を使うと同じデータを参照できます。

## ツールの引数

- `list_stories`: `query`（任意）、`sort`（`new`/`popular`）、`limit`（1〜100、既定50）、`offset`（0以上）
- `get_story`: `storyId`（正の整数、必須）
- `get_chapter`: `chapterId`（正の整数、必須）
- `get_branch_path`: `branchId`（正の整数、必須）

結果はJSON文字列の `content` と、同じ内容の `structuredContent` で返します。作品本文はユーザーの文章として扱うための説明をツールに付けています。

## ChatGPTからの認証付き接続（eletim.jp）

接続URLは **https://eletim.jp/novel/mcp**。匿名接続と共有トークンでは本文を読めません。既存の4ツールのみを公開し、投稿・編集ツールは追加していません。

### 登録値

| 項目 | 値 |
|---|---|
| 名前 | Novel Branches |
| MCP URL / OAuth resource / audience | `https://eletim.jp/novel/mcp` |
| 認証 | OAuth、事前登録クライアント（provided） |
| Client ID | `novel-chatgpt` |
| Client secret | VPSの `deploy/.env` にある `MCP_CHATGPT_CLIENT_SECRET`。Git・ログ・チャットへ貼らない |
| Scope | `openid offline_access novels:read`（`profile` も許可） |
| Token endpoint auth | `client_secret_basic`（`client_secret_post`も利用可能） |
| PKCE | S256必須 |
| Protected Resource Metadata | `https://eletim.jp/novel/.well-known/oauth-protected-resource` |
| Authorization server / issuer | `https://eletim.jp/id/realms/novel-branches` |
| OAuth Authorization Server Metadata | `https://eletim.jp/.well-known/oauth-authorization-server/id/realms/novel-branches` |
| OIDC discovery | `https://eletim.jp/id/realms/novel-branches/.well-known/openid-configuration` |
| Authorization URL | `https://eletim.jp/id/realms/novel-branches/protocol/openid-connect/auth` |
| Token URL | `https://eletim.jp/id/realms/novel-branches/protocol/openid-connect/token` |

RFC 9728の標準配置 `https://eletim.jp/.well-known/oauth-protected-resource/novel/mcp` とルートの `/.well-known/oauth-protected-resource` も同じresourceを返します。未認証のMCPは401を返し、`WWW-Authenticate` の `resource_metadata` と `scope` で発見先を通知します。ツール定義にもOAuth scopeを明示しています。本文やユーザー情報はメタデータに含めません。

### ChatGPT側の操作

1. [ChatGPT Plugins](https://chatgpt.com/plugins) の追加ボタンから **Add custom MCP server** を開く（利用プラン・ワークスペースの権限で表示が制限される場合あり）。
2. 名前と上記MCP URLを入力し、OAuthの事前登録クライアントとしてClient ID・secretを設定する。認証方式をNoneにはしない。入力欄がある場合はscopeに `openid offline_access novels:read` を指定する。エンドポイントは自動発見、手動指定を求められた場合は表のURLを使用する。
3. 画面に表示される**正確なコールバックURL**を確認する。現状はRFC 9207のissuer識別を満たすため、OpenAI公式のstable callback `https://chatgpt.com/connector_platform_oauth_redirect` を登録済み。実際の画面が異なる場合は下記コマンドでそのURLだけに変更する。ワイルドカードは使わない。
4. 登録を作成し、Keycloakの**novel-branches Realmの参加者**でログインして、閲覧権限を許可する。`master` Realmの `novel-admin` は参加者ではない。実利用者がまだなければ [VPS運用手順](eletim-vps.md) のアカウント追加を先に実施する。検証用アカウントは終了後に無効化する。
5. 新しい会話でプラグインを選び、「作品一覧を取得して」「この作品の第1話を読んで」「この分岐を読む順番を教えて」と依頼する。`list_stories` → `get_story` → `get_chapter` / `get_branch_path` の取得を確認する。

現在の操作画面は [OpenAI公式の接続手順](https://developers.openai.com/plugins/deploy/connect-chatgpt)、OAuthの要件とコールバック選択は [公式認証ガイド](https://developers.openai.com/plugins/build/auth) に基づく。登録を操作できるChatGPTセッションはこの作業環境には接続されていないため、登録と本人ログインは利用者側の操作が必要。

### クライアントの設定と更新

```bash
cd /home/ubuntu/novel_branches
python3 scripts/public-admin.py --configure-mcp
# ChatGPT画面が別のURLを表示した場合のみ、正確なURLを指定する
python3 scripts/public-admin.py --configure-mcp --chatgpt-callback 'https://chatgpt.com/connector/oauth/実際のcallback_id'
```

コマンドは専用secretを初回だけ生成し、既存secretを再生成しない。保存値とKeycloakが不一致なら停止する。`OIDC_MCP_AUDIENCE` を正規MCP URLへ設定する。既存Webクライアント、ユーザー、パスワード、作品は変更しない。CLIが許可するcallbackは上記stable URLまたはChatGPTのcallback ID付きの厳密なHTTPS URLのみ。

Keycloak 26.8.1の `resource-indicators` を有効化し、resource server client `novel-mcp` の `resource_url` と専用クライアントのaudience mapperを使って、認可・コード交換のresourceを検証する。`novel-chatgpt` は認可コード＋通常/offline refresh tokenのみ、PKCE S256必須、パスワードgrant・implicit・service accountは無効。動的クライアント登録は公開Nginxで拒否し、メタデータのOAuth側にも登録エンドポイントを広告しない。

Resource IndicatorsはこのKeycloak版ではexperimentalであるため、バージョンを固定して実OAuthで検証した。アップグレード時は [Keycloak公式MCPガイド](https://www.keycloak.org/securing-apps/mcp-authz-server) と同梱テストで互換性を再確認する。CIMDやDCRは有効化していない。

APIは署名・issuer・canonical URL audience・期限・`novel-member`・`novels:read` を毎回検証する。アクセストークンは約5分。ChatGPTが要求する `offline_access` を受け入れ、offline refresh tokenを発行する。現在のRealmではoffline idle timeoutは30日で、利用中の最大期間制限は未設定。通常のWeb SSO（アイドル約30分・最大約8時間）とは別に維持される。失効・同意取り消し後は再接続・再ログインする。

### 再現用検証

```bash
npm test
# VPSで専用の検証アカウントだけを有効にしたうえで実行
node scripts/test-mcp-public.mjs
TEST_STACK_ENV=deploy/.test/public.env npm run test:browser
```

`test-mcp-public.mjs` はGit管理外の `deploy/.test/public.env` と `chatgpt.env` を読む。後者にはClient ID・secret・callbackを0600で保存する。認証コード・トークンをログ・trace/HARへ出さない。ChatGPT向けcallbackへのリダイレクトはテストブラウザ内で横取りし、Keycloakの実コードを実HTTPSエンドポイントで交換する。**これは実ブラウザによるOAuth/MCP検証であり、ChatGPT本体からの接続確認ではない。**

initialize、4ツール、offline更新トークン、匿名・不正トークン・ロール不足（scope不足は署名付きトークンの単体テスト）・不正PKCE・認可コード再利用・不正resourceの拒否を確認する。さらに実時間約5分待って期限切れアクセストークンの拒否とrefreshによる復帰を確認する。既存Webのログイン・閲覧・投稿は別のブラウザ回帰検証で確認する。

実装時の参照仕様：
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools

## invalid_scope: openid offline_access の修正（2026-11-01）

実際の要求で `openid` 単独は成功、`openid offline_access` と3スコープの要求は `invalid_scope` を返すことを再現した。原因は `offline_access` が `novel-chatgpt` のOptional client scopeに未割り当てだったこと。エラー表示は要求した全scopeを含むため、`openid` 自体の拒否ではなかった。`openid` はKeycloakのOIDC用特別scopeで、同名の偽client scopeは追加していない。

修正した設定:

- Default client scopes: `basic`, `novels:read`。
- Optional client scopes: `profile`, `offline_access`。
- クライアントのrealm role scope mapping: `novel-member`, `offline_access`。
- `koji` を含む既存参加者は既定realm role経由で `offline_access` を既に持っていたため、ユーザーのロール・パスワードは変更していない。
- `novels:read` は専用の閲覧クライアントの既定scopeに移し、ChatGPTが `openid offline_access` だけを要求しても同意画面を経て発行トークンに含まれる。MCP側でread scopeや参加ロールを省略して許可する実装ではない。
- 独自のMCP検証はscopeをスペースで分割し `novels:read` の厳密な要素一致を要求する。文字列全体の一致やOIDC scopeの拒否はしていない。scope順序・追加scope・複数スペースを許可し、`novels:reader` やreadなしは拒否するテストを追加した。
- OAuth discoveryにも `offline_access` を広告する。PRMと各ツールで要求する業務権限は `novels:read` のまま。

さらに、この版のKeycloakではoffline refresh時にresourceによるaudienceの変換が失われ、access tokenのaudが `novel-mcp` へ戻る挙動を実測した（[上流の関連issue](https://github.com/keycloak/keycloak/issues/53261)）。専用クライアントにcanonical URLのみを追加する**独立したAudience mapper**を設定し、更新後もMCPが要求するURL audienceを含める。Keycloakの同じmapperにclient audienceとcustom audienceを併記すると前者が優先されるため、2つを分けている。MCPの検証に旧client IDを追加して緩和する変更はしていない。更新後のaudはcanonical URLと既存resource client IDのみで、別resourceの権限は付けない。resource指定を切り替えて複数MCPへ委譲する用途には使わない。

既存クライアントのscope紐付けとmapperはAdmin RESTの専用エンドポイントでも更新し、再起動のrealm再インポートに依存しない。Client ID・secret・callbackは維持する。

ChatGPT側は同じ設定で**OAuth認証を再実行**し、新たなoffline/read権限に同意する。通常は再登録不要。古いメタデータが残る場合は接続のRefreshを行い、それでも改善しない場合だけ同じURL/Client ID/secretで接続を作り直す。scope欄がある場合は上記の3scopeを入力する。

検証用ユーザーの後片付けではユーザー無効化・オンラインログアウトに加え、`novel-chatgpt` への同意とoffline tokenも取り消す。この操作の対象は専用の検証ユーザー3名だけで、`koji` の同意・セッションは変更しない。

## 各話の更新情報

get_storyのchapters、get_chapter、get_branch_pathは各話のauthor_id/author、updated_at、revisionと最新本文を返す。作品・branchの作成者と話の制作者は別。共有される話の編集はすべての経路で同じ内容になる。4つの閲覧ツールのみで、編集・投稿APIはMCPに公開しない。OAuth、novel-member、novels:readの必須検証は変更していない。
