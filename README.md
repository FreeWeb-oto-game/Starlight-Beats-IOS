# Starlight Beats iOS

既存の Starlight Beats HTML/CSS/JavaScript アプリを Capacitor 8.5.2 でiOSアプリ化するためのプロジェクトです。

## 構成

```text
starlight-beats-capacitor/
├─ www/
│  ├─ index.html
│  ├─ styles.css
│  ├─ storage.js
│  ├─ settings.js
│  ├─ haptics.js
│  ├─ audio.js
│  ├─ lane-map.js
│  ├─ screens.js
│  ├─ game.js
│  ├─ editor.js
│  └─ assets/
├─ .github/
│  └─ workflows/
│     └─ build-ios.yml
├─ capacitor.config.json
├─ package.json
└─ README.md
```

`www/` は TITLE → SONG SELECT → DIFFICULTY SELECT → GAME CONFIG → READY → GAME → RESULT のフル画面フローと、PRACTICE（区間ループ / 速度 / オートプレイ）、CHART EDIT（譜面エディター、UNDO/REDO対応）、SETTINGS（ノーツ速度・入力/音声オフセット・ミラー・ハプティクス・表示・データ管理）を備えています。

### 各ファイルの役割

- `storage.js` : 設定・スコア・譜面を localStorage に保存する薄いラッパー
- `settings.js` : 設定値の読み書きと、設定UIコントロールの汎用バインディング
- `haptics.js` : Capacitor Haptics（実機）と `navigator.vibrate`（Web）を吸収するハプティクス層
- `audio.js` : Web Audio の `AudioBufferSourceNode` で楽曲を再生する音声エンジン（入力オフセット/音声オフセット/速度変更に対応、デコード失敗時は内蔵シンセにフォールバック）
- `lane-map.js` : 内蔵譜面「MELODINIQ」のノーツデータ
- `screens.js` : 画面遷移・楽曲選択・リザルト表示などのUIコントローラー
- `game.js` : 判定・スコア・ライフ・演出を司るリズムエンジン本体
- `editor.js` : 譜面エディター（グリッド編集・エクスポート/インポート・UNDO/REDO）

新規に作成した譜面は SONG SELECT に「CUSTOM CHART」として表示されます。

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
