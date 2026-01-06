const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(port, () => console.log(`Listening on ${port}`));

const { Client } = require('discord.js-selfbot-v13');
const { Streamer, prepareStream, playStream, Utils, Encoders } = require('@dank074/discord-video-stream');
const ytdl = require('@distube/ytdl-core');
const ffmpegPath = require('ffmpeg-static');

process.env.FFMPEG_PATH = ffmpegPath;

const client = new Client({
  checkUpdate: false,
  autoRedeemNitro: false
});

const streamer = new Streamer(client);

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

let currentGuildId = null;

client.on('messageCreate', async message => {
  if (message.author.id !== client.user.id) return;

  const contentLower = message.content.toLowerCase().trim();
  const args = message.content.trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  if (contentLower === 'めいく' || contentLower === 'めいっく' || contentLower === 'make') {
    if (!message.reference?.messageId) {
      return message.reply({ content: 'リプライしてから「めいく」', allowedMentions: { repliedUser: false } });
    }

    try {
      await message.reply({ content: '', allowedMentions: { repliedUser: false } });
      await message.delete().catch(() => {});
    } catch {}
    return;
  }

  if (cmd === '!ping') {
    const wsPing = Math.round(client.ws.ping);
    const start = Date.now();
    const msg = await message.channel.send('Ping...');
    const apiPing = Date.now() - start;
    await msg.edit({ content: `WS: ${wsPing}ms\nAPI: ${apiPing}ms` });
    return;
  }

  if (cmd === '!vc' && args[0]?.toLowerCase() === 'join') {
    const channelId = args[1];
    if (!channelId) return message.reply({ content: '!vc join <id>', allowedMentions: { repliedUser: false } });

    currentGuildId = message.guild?.id;
    if (!currentGuildId) return;

    try {
      await streamer.joinVoice(currentGuildId, channelId);
      await message.reply({ content: `VC参加: ${channelId}`, allowedMentions: { repliedUser: false } });
    } catch {}
    return;
  }

  if (cmd === '!play') {
    const url = args[0];
    if (!url || !ytdl.validateURL(url)) return message.reply({ content: 'YouTube URLを', allowedMentions: { repliedUser: false } });

    if (!streamer.voiceConnection) return message.reply({ content: '!vc join してから', allowedMentions: { repliedUser: false } });

    try {
      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, {
        filter: 'videoandaudio',
        quality: 'highestvideo'
      });

      if (!format?.url) return;

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

      command.on('error', () => {});

      await playStream(output, streamer, { type: 'go-live' });

      await message.reply({
        content: `${info.videoDetails.title}\n${url}`,
        allowedMentions: { repliedUser: false }
      });
    } catch {}
  }
});

const token = process.env.TOKEN;
if (token) client.login(token);
