# Starlight Beats iOS

既存の Starlight Beats HTML/CSS/JavaScript アプリを Capacitor 8.5.2 でiOSアプリ化するためのプロジェクトです。

## 構成

```text
starlight-beats-capacitor/
├─ www/
│  ├─ index.html
│  ├─ styles.css
│  ├─ game.js
│  ├─ editor.js
│  ├─ lane-map.js
│  └─ assets/
├─ .github/
│  └─ workflows/
│     └─ build-ios.yml
├─ capacitor.config.json
├─ package.json
└─ README.md
```

`www/` 内の5ファイルは元ファイルを変更せずにそのまま配置しています。

## assets

元プロジェクトの `assets/` フォルダを `www/assets/` としてコピーしてください。

特にゲームコードでは `assets/melodiniq.mp3` を使用します。

## Windowsでの準備

```powershell
npm install
```

Windows上ではiOSネイティブプロジェクトの生成・Xcodeビルドは実行できません。GitHub Actionsを使う場合は、このリポジトリをGitHubへpushしてください。

## GitHub ActionsでiOSビルド

GitHubの Actions から `Build iOS IPA` を手動実行します。

このワークフローはGitHubのmacOSランナー上でiOSネイティブプロジェクトを生成し、署名なしの `StarlightBeats-unsigned.ipa` をArtifactsとして出力します。

署名なしIPAは通常のiPhone実機にはインストールできません。実機テストにはAppleの開発用署名が必要です。このリポジトリにはApple ID、証明書、Provisioning Profileなどの秘密情報を保存していません。

## macOSが使える場合

```bash
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

その後、Xcodeで実機を選択して署名設定を行います。

## Web版の変更

Web版のファイルを編集した場合は、変更後に次を実行します。

```bash
npx cap sync ios
```

`www/` がCapacitorのWebアセットとしてiOSアプリへ同期されます。
