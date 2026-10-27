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

## ChatGPTについて

この実装はMCPサーバー側です。ChatGPTアカウントへのコネクター登録は実施していません。利用するChatGPT環境で外部MCPのURLと認証を設定できるか、実際の設定画面で確認する必要があります。インターネットから接続する場合はChatGPTから到達できるHTTPS URLが必要です。認証方法が合わない場合は、クライアント側設定または認証方式の追加で対応します。

実装時の参照仕様：
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
