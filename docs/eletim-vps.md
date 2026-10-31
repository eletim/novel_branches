# eletim.jp VPS運用

配置先 `/home/ubuntu/novel_branches`。予定公開URL `https://eletim.jp/`。

**配置作業中・未公開。** 既存ntfyからの切り替えは未承認・未実施。初回起動後にVPSへのSSH/HTTPS接続が失われ、SSHでKeycloakを停止して復旧済み。公開後運用手順を準備し、実環境での検証を進めている。
既存の `/home/ubuntu/notify-server` のCaddyでTLS終端・HTTP転送・証明書自動更新を継続し、小説用Nginxへ内部ネットワークで転送する。ntfyのデータは保持する。Caddyを停止すると小説サイトも利用できなくなる。

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

## Caddyと証明書

設定 `/home/ubuntu/notify-server/Caddyfile`、永続証明書 `/home/ubuntu/notify-server/data/caddy/data`。証明書は既存のLet's Encrypt証明書を利用し、Caddyが自動更新する（[公式仕様](https://caddyserver.com/docs/automatic-https)）。証明書ファイルをNginxへコピーする運用は不要。80/443をCaddyに開放したままにする。Caddy管理ポート2019はホストに公開しない。

```bash
docker exec notify-server-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec notify-server-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
openssl s_client -connect eletim.jp:443 -servername eletim.jp </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer
```

公開構成は `deploy/compose.public.yaml` 単独。Caddy用には `NGINX_TEMPLATE=./nginx/caddy.conf.template` を指定する。外部入力の転送ヘッダーはNginxで上書きし、Keycloakの公開issuerは `https://eletim.jp/id/realms/novel-branches` 固定（[Keycloak公式](https://www.keycloak.org/server/reverseproxy)）。

## 2026-11-01 配置作業中の障害

初回起動ではKeycloakのJavaヒープのみ256MiBに制限し、コンテナ全体の上限を設定していなかった。realm初期化完了後にVPSのSSH・HTTPSがタイムアウトし、pingのみ応答する状態を観測した。直前の空きメモリ約124MiBからメモリ逼迫を疑っているが、ホストログ未取得のため原因は未確定。公開先切り替え前に発生。修正でKeycloakコンテナ全体のメモリ上限を追加した。SSH経由でKeycloakを停止し復旧した。2GiBのswapを新設し永続化、Javaヒープ160MiB・メタスペース256MiB・コンテナ全体512MiBに設定した。128MiBのメタスペース制限は不足しJavaのOutOfMemoryErrorを確認したため増量した。VPSの再起動はしていない。

## 配置前検証結果

- `npm test`: 20件成功。依存監査: 脆弱性0件。
- VPS上の正式TLSを、SSHトンネルと専用Caddyから本番用Nginxへ接続して検証。証明書検証を無効化していない。既存の公開Caddy/ntfyの転送先は変更していない。
- 実Chromium: 2人のログイン、ログアウト、参加ロールなし拒否、新作、続話、分岐、入れ子の分岐、各経路の読む順番、グッド追加/取消/重複抑止、検索・並べ替え、下書き、競合、別ユーザーへの誤投稿防止、PC/スマホ幅を確認。
- 管理パス・master realm・healthは404、未ログインの作品APIは401。ログに秘密値・認可コードqueryの混入なし。
- 全4サービスの再起動前後でユーザー・作品・分岐・本文・票のSHA256が一致。VPS自体は再起動していない。
- バックアップから別プロジェクト `novel-restore-check-20261101-b` へ復元し、SQLite integrity OK、Keycloakユーザー4件を確認。最新バックアップでも `novel-restore-final-20261101` へ復元し、作品2件・分岐6件・話12件・グッド2件と作者情報のSHA256が本番DBと完全一致した。検証用復元コンテナは停止済み、volumeは保持。
- 検証用アカウントはランダムな `verify-` 接頭辞の3名。本番の初期realmにローカル検証ユーザーをインポートしていない。新規に作った「ブラウザ検証」作品は検証記録として保持する。終了時に専用3名を無効化し、Keycloakのセッションもログアウトする。
- 外部からの本番URLの最終確認は、既存ntfyのURL置き換えの承認後に実施する。

最新の検証済みバックアップ: `/home/ubuntu/novel-backups/20261031T232939Z`（日本時間2026-11-01 08:29:39、コード0a1e9eb）。検証アカウント3名は無効化・セッションログアウト済み。検証作品2件は削除していない。公開切り替え用の設定は `deploy/caddy/Caddyfile.eletim` に準備済みで、承認後に既存Caddyfileのバックアップを取ってから差し替え、validate/reloadし、外部HTTPSとログインを最終確認する。
