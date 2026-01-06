// index.js
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Render用ヘルスチェック & 常時稼働キープ
app.get('/', (req, res) => {
  res.send('Discord Selfbot is running! (24/7 via Render + UptimeRobot)');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});

// ───────────────────────────────────────────────────────────────
// Selfbot 本体
// ───────────────────────────────────────────────────────────────

const { Client } = require('discord.js-selfbot-v13');
const { Streamer, prepareStream, playStream, Utils, Encoders } = require('@dank074/discord-video-stream');
const ytdl = require('ytdl-core');
const ffmpegPath = require('ffmpeg-static');

if (!ffmpegPath) {
  console.error("ffmpeg-static not found! Video streaming will likely fail.");
}
process.env.FFMPEG_PATH = ffmpegPath;

const client = new Client({
  checkUpdate: false,
  autoRedeemNitro: false
});

const streamer = new Streamer(client);

client.on('ready', () => {
  console.log(`Selfbot logged in as ${client.user.tag} (${client.user.id})`);
  console.log("Available commands:");
  console.log("  !vc join <channelId>     → Join voice channel");
  console.log("  !play <youtube url>      → Start screen share streaming");
  console.log("  !ping                    → Check latency");
  console.log("  Reply + 「めいく」       → Quote reply (like Make it a Quote)");
});

let currentGuildId = null;

client.on('messageCreate', async message => {
  // Selfbotなので自分以外は完全に無視
  if (message.author.id !== client.user.id) return;

  const contentLower = message.content.toLowerCase().trim();
  const args = message.content.trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // ── めいく（引用リプライ機能） ───────────────────────────────────
  if (contentLower === 'めいく' || contentLower === 'めいっく' || contentLower === 'make') {
    if (!message.reference?.messageId) {
      return message.reply({
        content: "引用したいメッセージにリプライしてから「めいく」って送ってね！",
        allowedMentions: { repliedUser: false }
      });
    }

    try {
      // 引用付きリプライ（内容空でも引用プレビューは出る）
      await message.reply({
        content: "",
        allowedMentions: { repliedUser: false }
      });

      // 元の「めいく」メッセージを削除してスッキリ（任意）
      await message.delete().catch(() => {});
    } catch (e) {
      console.error("めいく引用失敗:", e);
      await message.reply({
        content: "引用リプライに失敗しました…権限を確認してください",
        allowedMentions: { repliedUser: false }
      }).catch(() => {});
    }
    return; // 他のコマンド処理はしない
  }

  // ── !ping ───────────────────────────────────────────────────────
  if (cmd === '!ping') {
    const wsPing = Math.round(client.ws.ping);

    const start = Date.now();
    const pingMsg = await message.channel.send("Ping計測中...");
    const apiPing = Date.now() - start;

    await pingMsg.edit({
      content: `🏓 Pong!\n**WebSocket**: ${wsPing}ms\n**API (往復)**: ${apiPing}ms`
    });
    return;
  }

  // ── !vc join <channelId> ───────────────────────────────────────
  if (cmd === '!vc' && args[0]?.toLowerCase() === 'join') {
    const channelId = args[1];
    if (!channelId) {
      return message.reply({
        content: "使い方: !vc join チャンネルID",
        allowedMentions: { repliedUser: false }
      });
    }

    currentGuildId = message.guild?.id;
    if (!currentGuildId) {
      return message.reply("サーバー内で実行してください");
    }

    try {
      await streamer.joinVoice(currentGuildId, channelId);
      await message.reply({
        content: `✅ ボイスチャンネルに参加しました (ID: ${channelId})`,
        allowedMentions: { repliedUser: false }
      });
    } catch (e) {
      console.error("VC join error:", e);
      await message.reply({
        content: "VC参加に失敗しました…IDか権限を確認してください",
        allowedMentions: { repliedUser: false }
      });
    }
    return;
  }

  // ── !play <youtube-url> ────────────────────────────────────────
  if (cmd === '!play') {
    const url = args[0];
    if (!url || !ytdl.validateURL(url)) {
      return message.reply({
        content: "有効なYouTube URLを指定してください",
        allowedMentions: { repliedUser: false }
      });
    }

    if (!streamer.voiceConnection) {
      return message.reply({
        content: "まず !vc join <channelId> でボイスチャンネルに参加してください",
        allowedMentions: { repliedUser: false }
      });
    }

    try {
      await message.reply({
        content: "📺 画面共有の準備中…（数秒〜十数秒かかります）",
        allowedMentions: { repliedUser: false }
      });

      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, {
        filter: 'videoandaudio',
        quality: 'highestvideo'
      });

      if (!format?.url) {
        throw new Error("適切なビデオ+オーディオフォーマットが見つかりませんでした");
      }

      const encoder = Encoders.software({
        x264: { preset: 'ultrafast', tune: 'zerolatency' }
      });

      const streamOptions = {
        encoder,
        width: 1280,
        height: 720,
        frameRate: 30,
        bitrateVideo: 1800,
        bitrateVideoMax: 2500,
        videoCodec: Utils.normalizeVideoCodec('H264')
      };

      const { command, output } = prepareStream(format.url, streamOptions);

      command.on('error', (err) => {
        console.error('FFmpeg error:', err);
        message.channel.send("ストリーミング中にエラーが発生しました…").catch(() => {});
      });

      await playStream(output, streamer, { type: 'go-live' });

      await message.reply({
        content: `🎥 ストリーミング開始！\n**${info.videoDetails.title}**\n${url}`,
        allowedMentions: { repliedUser: false }
      });

    } catch (e) {
      console.error("Streaming error:", e);
      await message.reply({
        content: "ストリーム開始に失敗しました…",
        allowedMentions: { repliedUser: false }
      });
    }
    return;
  }
});

// ── ログイン ──────────────────────────────────────────────────────
const token = process.env.TOKEN;
if (!token) {
  console.error("環境変数 TOKEN が設定されていません！\nRenderダッシュボード → Environment Variables に設定してください");
  process.exit(1);
}

client.login(token).catch(err => {
  console.error("ログイン失敗:", err.message || err);
  process.exit(1);
});
