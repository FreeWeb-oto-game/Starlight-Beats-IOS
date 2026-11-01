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
│  ├─ calibrate.js
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

`www/` は TITLE → SONG SELECT → DIFFICULTY SELECT → GAME CONFIG → READY → GAME → RESULT のフル画面フローと、PRACTICE（区間ループ / 速度 / オートプレイ）、CHART EDIT（譜面エディター、UNDO/REDO対応）、SOUND SYNC（音合わせ）、SETTINGS（ノーツ速度・入力/音声オフセット・ミラー・ハプティクス・表示・データ管理）を備えています。

判定は CHUNITHM 風の **JUSTICE CRITICAL / JUSTICE / ATTACK / MISS**、スコアは 1,000,000 点満点（フルコンボで最大 1,010,000 点）で、RANK は SSS+ 〜 D の段階評価です。ノーツは奥が狭い遠近のレーンを流れ、判定ラインは手前の黄色い帯です。

SOUND SYNC はメトロノーム（BPM 80〜200）に合わせて 16 回タップすると、端末の音声遅延とタップのクセを中央値で推定し、判定オフセットを自動設定します。手動の JUDGE OFFSET / AUDIO OFFSET（−150〜+150 ms）も同じ画面で調整できます。

起動時はタイトル前にブート画面（ロゴ → ローディング → TAP TO START）を表示し、タップでタイトルへ進みます（音声のアンロックも兼ねています）。iOS では横向き固定で起動します（`build-ios.yml` が生成後の Info.plist を書き換えます）。

SETTINGS には **PLAY**（FAIL / LANE COVER / LANE BRIGHT）と **DISPLAY**（JUDGEMENT / COMBO / FAST・LATE 表示）、**SOUND SYNC** を追加しています。FAIL は初期値 OFF（CHUNITHM と同じく途中失敗なし）で、ON にすると LIFE が尽きた時点で LIVE FAILED になります。リザルトには EARLY / LATE の内訳と平均タイミングを表示し、音合わせの再調整に使えます。

### 各ファイルの役割

- `storage.js` : 設定・スコア・譜面を localStorage に保存する薄いラッパー
- `settings.js` : 設定値の読み書きと、設定UIコントロールの汎用バインディング
- `haptics.js` : Capacitor Haptics（実機）と `navigator.vibrate`（Web）を吸収するハプティクス層
- `audio.js` : Web Audio の `AudioBufferSourceNode` で楽曲を再生する音声エンジン（入力オフセット/音声オフセット/速度変更に対応、デコード失敗時は内蔵シンセにフォールバック）
- `lane-map.js` : 内蔵譜面「MELODINIQ」のノーツデータ（TAP / EX TAP / FLICK / HOLD / AIR / SLIDE）
- `screens.js` : 画面遷移・楽曲選択・リザルト表示などのUIコントローラー
- `calibrate.js` : 音合わせ（SOUND SYNC）。メトロノームのタップから判定オフセットを自動算出します
- `game.js` : 判定・スコア・ライフ・演出を司るリズムエンジン本体
- `editor.js` : 譜面エディター（グリッド編集・エクスポート/インポート・UNDO/REDO）

新規に作成した譜面は SONG SELECT に「CUSTOM CHART」として表示されます。

### ノーツの種類

| 種類 | 色 | 取り方 |
| --- | --- | --- |
| TAP | 水色 | 判定線をタップ |
| EX TAP | 黄色 | 判定線をタップ（TAP と同じ判定、演出と効果音が強化） |
| FLICK | ピンク | 触れてから任意方向へスワイプ |
| HOLD | ミント | 頭を押してから終点まで押し続ける |
| AIR | 白 | 空中（判定線より上）を触れてから**上方向**へスワイプ |
| SLIDE | オレンジ | 頭を取ってからレーン上を指で追従。0.22 秒以上外れると MISS |

AIR は判定線より上の空中に浮いて見え、そのまま上へスワイプすると JUDGE されます（タップでは取れません）。SLIDE は頭と終点で判定され、途中は終点レーンに向かって指を動かし続ける必要があります。キーボード操作では AIR はレーンキーで、SLIDE はキーを押したままレーンを追う形で取れます。

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
