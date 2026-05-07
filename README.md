# buzzbait corporate site

株式会社バズベイト（buzzbait, inc.）公式サイト。
銀座のWebマーケティング会社 — キャッチコピー「ニッチでNo.1。」

## 構成

```
.
├── index.html          # 本体
├── styles.css          # スタイル
├── assets/
│   ├── favicon.png     # ファビコン / ナビロゴ
│   ├── og-image.png    # OGP画像 (1200x630)
│   └── water-main.jpg  # ヒーロー WebGL 用テクスチャ
├── robots.txt
└── sitemap.xml
```

純粋な静的サイト。ビルド不要。

## ローカル確認

```bash
# Python (推奨)
python3 -m http.server 8000

# Node がある場合
npx serve .
```

ブラウザで http://localhost:8000 を開く。
※ `file://` で直接開くと WebGL のテクスチャ読込が CORS でブロックされるため、必ずローカルサーバ経由で確認してください。

## デプロイ — Cloudflare Pages

1. https://dash.cloudflare.com/ → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. GitHub の `junf66/corporate-buzzbait` リポジトリを選択
3. **Production branch** に `main`（または当面は `claude/deploy-static-website-VEdvS`）
4. ビルド設定は **何も入力しない**（Build command も Build output directory も空欄）。ルート直下が静的サイト。
5. **Save and Deploy** で初回デプロイ。`https://corporate-buzzbait.pages.dev` のような仮 URL が払い出されます。

### カスタムドメイン (`buzzbait.co.jp`) 紐付け

Cloudflare Pages のプロジェクト → **Custom domains** → **Set up a custom domain**:

- Cloudflare で DNS を管理している場合: ドメイン入力 → 自動でCNAME/Aレコードが追加される
- 他社 DNS を使う場合: 表示される CNAME 値（`corporate-buzzbait.pages.dev` など）を登録会社の DNS に追加

設定変更後、`index.html` の以下と `robots.txt` / `sitemap.xml` 内の `buzzbait.co.jp` を実際のドメインに合わせて差し替えてください（既に `buzzbait.co.jp` で固定済み。それ以外を使う場合のみ要編集）:

- `<link rel="canonical">`
- `og:url`, `og:image`, `twitter:image`
- JSON-LD `url`, `logo`, `image`

## お問い合わせフォームについて

現在はクライアント側のダミー実装（送信ボタン押下で「送信されました ✓」と表示するだけ）です。
本番運用で実際にメールを受信したい場合は次のいずれかを推奨：

- **Cloudflare Pages Functions + Resend / SendGrid**（同じCloudflareインフラ上で完結）
- **Formspree**（HTMLの`<form action>`を差し替えるだけで導入可・無料枠あり）
- **Web3Forms**（同上）

## ブランチ運用

このリポジトリでの作業は `claude/deploy-static-website-VEdvS` ブランチで進めています。
本番化する際は `main` にマージしてください。
