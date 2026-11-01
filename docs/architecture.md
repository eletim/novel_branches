# 初期設計

## 目的

まず2〜3人が、小説を投稿し、任意の話から別の展開を書き、双方を読み、グッドを付けられること。MCPからも同じ本文と分岐関係を取得できること。

## 構成

Node.js 24標準のHTTPサーバー、SQLite、ブラウザのHTML/CSS/JavaScript。ローカル開発では外部サービスの契約なしで起動できます。公開用はKeycloakのOIDC認証とNginxのHTTPS入口を使用します。Docker用の構成も用意しています。

- `src/store.mjs`: データとトランザクション、ユーザー認証
- `src/server.mjs`: Web、HTTP API、Bearer認証付きHTTP MCP
- `src/mcp.mjs`: MCPツールとJSON-RPCディスパッチ
- `src/stdio.mjs`: 改行区切りJSONのstdioトランスポート
- `public/`: 日本語UI、読書画面、下書き保存

## データ

| エンティティ | 意味 |
|---|---|
| users | ログイン用ユーザー。パスワードはsalt付きscryptハッシュ |
| sessions | ランダムなセッションのハッシュと有効期限 |
| stories | 作品全体。作品名、あらすじ、最初の作者 |
| branches | 同じ作品内のひとつの展開。作者、分岐元の話、最新話 |
| chapters | 話。所属展開、直前の話、タイトル、本文、制作者、最終更新日時、revision |
| likes | ユーザーと話の複合主キーによる1人1票 |

第1話の `parent_id` はNULL、それ以外は既存の話を指します。制作者・親・所属展開は投稿後変更しません。タイトルと本文はその話の制作者だけが編集できます。新しい話だけを末端に追加するため循環はできません。展開の `head_id` から親を辿って逆順にすると、分岐前の共通部分も含む読書順になります。

例：本編がA→B→C、Bから分岐してD→Eなら、分岐の読書順はA→B→D→E。AとBの本文・グッドは両方の展開で共通です。分岐内の票数は、その分岐が独自に投稿した話の合計です。作品の票数は全話への票の合計です。

新作投稿、続話投稿、別案・分岐作成、編集は `BEGIN IMMEDIATE` のトランザクションで行います。続話投稿は画面が持つ `expectedHeadId` と現在の最新話が一致する場合にだけ受け付けます。別タブからの同時投稿で意図せず順番が変わるのを防ぎます。

## 初期運用

ローカルパスワード認証のアカウントはCLIで追加します。Keycloak構成ではKeycloakがアカウントと参加ロールを管理します。ログインにはHttpOnly / SameSite=Lax cookieを使用し、パスワード照合失敗の試行を接続元IP単位で制限します。HTTPS運用時はSecure属性を設定します。本文はHTMLとして解釈せず表示します。外部Originの操作を拒否します。

MCPは閲覧専用で、ブラウザ用cookieと独立したBearerトークンで認証します。セッションを必要としないJSON応答型Streamable HTTPと、ローカルstdioを実装しています。

## バックアップ

停止できる運用ではサーバーを停止してからDBをコピーしてください。起動中のバックアップはSQLiteのバックアップ機能を使用します。WAL動作中に `.db` だけを単純コピーすると、直近の変更を取りこぼす可能性があります。Dockerのvolume削除はデータ削除になるため、通常の停止には `docker compose down`（`-v` なし）を使用します。

## 公開用の認証

`src/auth.mjs` は `openid-client` / `jose` を使用します。`oidc_identities` が issuer + sub と既存の作者IDを対応付け、`oidc_logins` は一度だけ利用できるログイン確認情報を保存します。セッションには認証方式を持たせ、OIDCモードではローカルセッションを受け付けません。既存の本文・所有権は変更しない追加型のDBマイグレーションです。構成とテスト手順は [public-server.md](public-server.md) を参照してください。

分岐の目次から読書すると、URLの `?branch=ID`（hash内）に選択した展開を保持し、その経路の次話・前話へ移動します。変更APIの `X-Novel-User` は画面が想定するユーザーと認証済みセッションの一致確認にのみ使います。認証や権限付与の代わりにはなりません。

## 目次と話の編集（schema v3）

作品の最初の制作者はstories、各話の実際の投稿者はchapters.author_idに保存する。参加者なら他者の経路にも追加できる。既存v2の話は当時の所有権ルールに従い所属branchの作者で補完し、updated_atはcreated_at、revisionは1へ移行する。既存の親子関係・作者ID・票は保持する。

通常の目次は選択した経路を縦に表示し、候補は同じparent_idの話だけをまとめる。第1話はNULL親の候補を扱い、途中・入れ子でも選択した祖先と整合する続きだけを表示する。選択したbranchのheadで読み終え、別branchの子孫へは自動で進まない。hash内branchを本文・前後移動・目次で引き継ぐ。

PATCH /api/chapters/:idはサーバーでauthor_idを照合する。expectedRevisionが一致する場合のみ本文・タイトル・updated_at・revisionを変更し、競合は409、他者は403。制作者や親の変更は400。編集は共通ノードを更新するので全経路とMCPで同じ最新版を読む。編集revisionと続話expectedHeadIdは下書きと共に保存し、失敗・再読込で入力を残す。最新状態からやり直す操作は明示的な下書き破棄を伴う。

## Mainとホーム表示設定（schema v4）

stories.main_branch_idは作品の初期読書経路を示す。移行は最初の「本編」を優先し、なければ最古のbranchを使う。既存branch名・ID・話の親子関係・headは変更しない。URL内branchが指定されればその経路を使用し、末尾から別branchへ自動延長しない。別案は同じparent_idの話から現在の話を除いて数える。全branchを選べる小さな読書経路selectにより、現在の末尾の先から作られたbranchにも明示的に切り替えられる。

stories.hidden_from_homeは0/1、既存・新規とも0。PATCH /api/stories/:idのhiddenFromHome真偽値で変更し、サーバーで最初の制作者を検証する。Web一覧はview=allの場合だけ含め、検索条件・人気順・LIMIT/OFFSETより前に絞る。URLからの作品/本文/グッドや権限は変えない。MCPのlist_storiesはincludeHidden=trueを明示し従来の取得範囲を維持する。

## 作品情報（schema v5）

storiesにsetting_notes（TEXT、空文字）、revision（1から）、updated_at（既存はcreated_at）を追加する。title/summary/hidden_from_home/setting_notesを最初の作者だけがCAS更新できる。メモは100000文字までの自由記述で、HTMLとして解釈せず改行・空白を保持する。更新はstoriesの該当列だけで、branch/chapter/like/作者やMainは変更しない。目次から作品情報へbranch付きで移動し、閲覧と編集フォームを分ける。下書きはユーザーと作品ID別でrevisionも保持する。概要一覧はメモを除外し、get_storyで取得する。
