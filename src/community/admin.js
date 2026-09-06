const { ChannelType } = require("discord.js");

module.exports = async function categoryReset(interaction) {
    try {
        const category = interaction.options.getChannel("카테고리");

        console.log("선택된 카테고리:", category?.name);
        console.log("카테고리 ID:", category?.id);

        if (!category || category.type !== ChannelType.GuildCategory) {
            return await interaction.reply({
                content: "카테고리를 선택해주세요.",
                ephemeral: true,
            });
        }

        const channels = interaction.guild.channels.cache.filter(
            channel => channel.parentId === category.id
        );

        console.log("삭제할 채널 수:", channels.size);

        await interaction.reply({
            content: `「${category.name}」 카테고리를 초기화합니다.`,
            ephemeral: true,
        });

        for (const channel of channels.values()) {
            console.log("삭제 중:", channel.name, channel.id);

            await channel.delete("카테고리 초기화");
        }

        await category.delete("카테고리 초기화");

    } catch (error) {
        console.error("카테고리 초기화 오류:", error);

        // 아직 응답하지 않았다면 오류 응답
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "카테고리 초기화 중 오류가 발생했습니다.",
                ephemeral: true,
            });
        }
    }
};