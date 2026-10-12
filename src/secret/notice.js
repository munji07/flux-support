"use strict";

const { ChannelType, EmbedBuilder, Events } = require("discord.js");

const { getConfig, nextJoinSeq } = require("./db");
const { buildJoinNoticeData, NOTICE_ALLOWED_MENTIONS } = require("./format");

function isUsableTextChannel(channel) {
  return Boolean(channel) && channel.type === ChannelType.GuildText;
}

async function sendJoinNotice(member, db) {
  const guildId = member.guild.id;

  const config = getConfig(db, guildId);
  if (!config || !config.channel_id) return;

  let channel;
  try {
    channel = await member.guild.channels.fetch(config.channel_id);
  } catch (error) {
    console.error(
      `[join-notice] 알림 채널 조회 실패 guild=${guildId} channel=${config.channel_id} error=${error.message}`,
    );
    return;
  }

  if (!isUsableTextChannel(channel)) {
    console.error(
      `[join-notice] 알림 채널을 사용할 수 없습니다 guild=${guildId} channel=${config.channel_id}`,
    );
    return;
  }

  const seq = nextJoinSeq(db, guildId);
  if (!seq) {
    console.error(`[join-notice] 순번을 배정하지 못했습니다 guild=${guildId}`);
    return;
  }

  const data = buildJoinNoticeData({ member, seq });

  try {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(data.title)
          .setColor(data.color)
          .setTimestamp()
          .setThumbnail(data.thumbnail)
          .setFooter({ text: data.footer })
          .addFields(data.fields),
      ],
      allowedMentions: NOTICE_ALLOWED_MENTIONS,
    });
  } catch (error) {
    console.error(
      `[join-notice] 알림 전송 실패 guild=${guildId} member=${member.id} channel=${config.channel_id} error=${error.message}`,
    );
  }
}

function registerJoinNotice(client, db) {
  client.on(Events.GuildMemberAdd, (member) => {
    void (async () => {
      try {
        await sendJoinNotice(member, db);
      } catch (error) {
        console.error(
          `[join-notice] 알림 처리 중 예외 guild=${member.guild.id} member=${member.id} error=${error.message}`,
        );
      }
    })();
  });

  client.on(Events.GuildMemberRemove, (member) => {
    void (async () => {
      try {
        const config = getConfig(db, member.guild.id);
        if (!config?.leave_channel_id) return;

        const channel = await member.guild.channels
          .fetch(config.leave_channel_id)
          .catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) return;

        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("조직원이 서버를 떠났다.")
              .setColor(0xed4245)
              .setThumbnail(member.displayAvatarURL())
              .addFields(
                { name: "퇴장한 조직원", value: `<@${member.id}>` },
                {
                  name: "서버 가입일",
                  value: member.joinedAt
                    ? new Intl.DateTimeFormat("ko-KR", {
                        timeZone: "Asia/Seoul",
                        dateStyle: "long",
                      }).format(member.joinedAt)
                    : "확인할 수 없음",
                },
              )
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.error(
          `[leave-notice] 알림 처리 실패 guild=${member.guild.id} error=${error.message}`,
        );
      }
    })();
  });
}

module.exports = { registerJoinNotice, sendJoinNotice };
