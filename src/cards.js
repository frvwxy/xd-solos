import {
  ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';

export function cardWithHeader(guild, content, color, iconSize = 256) {
  const card = new ContainerBuilder().setAccentColor(color);
  const header = new TextDisplayBuilder().setContent(content);
  const icon = guild.iconURL({ size: iconSize });
  if (icon) {
    card.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(header)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon)));
  } else {
    card.addTextDisplayComponents(header);
  }
  return card;
}

export function addDivider(card) {
  return card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
}

export function cardMessage(card, mentionUserId = null) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      ...(mentionUserId ? [new TextDisplayBuilder().setContent(`<@${mentionUserId}>`)] : []),
      card,
    ],
    allowedMentions: mentionUserId ? { parse: [], users: [mentionUserId] } : { parse: [] },
  };
}
