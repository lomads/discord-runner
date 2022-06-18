/* eslint no-return-await: "off" */

import {
  GuildMember,
  PartialGuildMember,
  Role,
  Permissions,
  MessageEmbed,
  Channel,
  ThreadChannel,
  OverwriteResolvable,
  Collection,
  TextChannel,
  Message,
  PermissionOverwrites,
  MessageButton,
  MessageOptions,
  MessageActionRow,
} from "discord.js";
import axios from "axios";
import Main from "../Main";
import logger from "../utils/logger";
import {
  ChannelObj,
  CreateChannelParams,
  DeleteChannelAndRoleParams,
  Emote,
  InviteResult,
  ManageRolesParams,
  Poll,
  ButtonMetaData,
  UserResult,
} from "./types";
import {
  createInteractionPayload,
  denyViewEntryChannelForRole,
  getBackendErrorMessage,
  getChannelsByCategoryWithRoles,
  getErrorResult,
  getJoinReplyMessage,
  getUserResult,
  getCategoryFieldValues,
  getRoleNames,
  getNotAccessedRoleIds,
  getDiscordRoleIds,
  printRoleNames,
  getLinkButton,
} from "../utils/utils";
import config from "../config";
import { getGuildOfServer } from "../service";
import redisClient from "../database";
import { createPollText } from "./polls";

const DiscordServerNames: { [guildId: string]: [name: string] } = {};

const notifyAccessedChannels = async (
  member: GuildMember | PartialGuildMember,
  roleId: string,
  roleName: string
) => {
  const guildOfServer = await getGuildOfServer(member.guild.id);
  const discordRoleIds = getDiscordRoleIds(guildOfServer);

  const memberRoles = member.roles.cache
    .filter((role) => role.id !== member.guild.roles.everyone.id)
    .map((role) => role.id);

  const accessedRoleIds = discordRoleIds.filter((guildRoleId) =>
    memberRoles.some((memberRoleId) => memberRoleId === guildRoleId)
  );
  const accessedRoleNames = getRoleNames(member.guild, accessedRoleIds);

  const notAccessedRoleIds = getNotAccessedRoleIds(
    discordRoleIds,
    accessedRoleIds
  );
  const notAccessedRoleNames = getRoleNames(member.guild, notAccessedRoleIds);

  const fields = getCategoryFieldValues(member.guild, [roleId]);

  const description = `\n\n${printRoleNames(
    accessedRoleNames,
    true,
    roleName
  )}\n${printRoleNames(notAccessedRoleNames, false)}\n${
    notAccessedRoleNames.length > 0 ? "\n" : ""
  }...giving you access to the following channels:\n`;

  const embed = new MessageEmbed({
    title: `You've got a new role in ${member.guild.name}!`,
    description,
    color: 0x0dff00,
    fields,
  });

  const button = getLinkButton(
    "View details",
    `${config.guildUrl}/${guildOfServer.urlName}/?discordId=${member.id}`
  );

  const messages = {
    components: [new MessageActionRow({ components: [button] })],
    embeds: [embed],
  };

  try {
    await member.send(messages);
  } catch (error) {
    if (error?.code === 50007) {
      logger.verbose(`Cannot send messages to ${member.user.username}`);
    } else {
      logger.error(error.message);
    }
  }
};

const manageRoles = async (
  params: ManageRolesParams,
  isUpgrade: boolean
): Promise<UserResult> => {
  logger.verbose(`manageRoles params: ${JSON.stringify(params)}, ${isUpgrade}`);
  const { platformUserId: userId, guildId, roleId, message } = params;

  const guild = await Main.Client.guilds.fetch(guildId);

  const member = await guild.members.fetch(userId);

  const redisKey = `joining:${member.guild.id}:${member.id}`;
  const redisValue: string = await redisClient.getAsync(redisKey);
  if (redisValue) {
    const messageText = await getJoinReplyMessage(
      [roleId],
      member.guild,
      member.id
    );

    try {
      await axios.patch(
        `https://discord.com/api/v8/webhooks/${Main.Client.application.id}/${redisValue}/messages/@original`,
        { content: messageText }
      );
      redisClient.client.del(redisKey);
    } catch (err) {
      logger.error(err);
    }
  }

  const hasRole = member.roles.cache.has(roleId);

  if ((isUpgrade && !hasRole) || (!isUpgrade && hasRole)) {
    let updatedMember: GuildMember;
    if (isUpgrade) {
      updatedMember = await member.roles.add(roleId);
    } else {
      updatedMember = await member.roles.remove(roleId);

      const guildOfServer = await getGuildOfServer(guild.id);
      const discordRoleIds = getDiscordRoleIds(guildOfServer);

      const memberRoles = member.roles.cache
        .filter((role) => role.id !== guild.roles.everyone.id)
        .map((role) => role.id);

      const accessedRoleIds = discordRoleIds.filter((guildRoleId) =>
        memberRoles.some((memberRoleId) => memberRoleId === guildRoleId)
      );
      const accessedRoleNames = getRoleNames(guild, accessedRoleIds);

      const notAccessedRoleIds = getNotAccessedRoleIds(
        discordRoleIds,
        accessedRoleIds
      );
      const notAccessedRoleNames = getRoleNames(guild, notAccessedRoleIds);

      const fields = getCategoryFieldValues(guild, [roleId]);

      const description = `\n\n${printRoleNames(
        accessedRoleNames,
        true
      )}\n${printRoleNames(notAccessedRoleNames, false, message)}\n${
        notAccessedRoleNames.length > 0 ? "\n" : ""
      }...revoking your access from the following channels:\n`;

      const embed = new MessageEmbed({
        title: `You lost a role in ${member.guild.name}!`,
        description,
        color: 0xff0000,
        fields,
      });

      const button = getLinkButton(
        "View details",
        `${config.guildUrl}/${guildOfServer.urlName}/?discordId=${member.id}`
      );

      const messages = {
        components: [new MessageActionRow({ components: [button] })],
        embeds: [embed],
      };

      try {
        await updatedMember.send(messages);
      } catch (error) {
        if (error?.code === 50007) {
          logger.verbose(
            `Cannot send messages to ${updatedMember.user.username}#${updatedMember.user.discriminator}`
          );
        } else {
          logger.error(JSON.stringify(error));
        }
      }
    }

    if (isUpgrade) {
      try {
        await notifyAccessedChannels(updatedMember, roleId, message);
      } catch (error) {
        logger.error(error);
      }
    }

    return getUserResult(updatedMember);
  }

  return getUserResult(member);
};

const generateInvite = async (
  guildId: string,
  inviteChannelId: string
): Promise<InviteResult> => {
  logger.verbose(`generateInvite params: ${guildId} ${inviteChannelId}`);
  const cachedInvite = Main.inviteDataCache.get(guildId);
  logger.verbose(`cached invite code: ${cachedInvite?.code}`);

  if (cachedInvite) {
    return {
      code: cachedInvite.code,
    };
  }

  const guild = await Main.Client.guilds.fetch(guildId);
  const invite = guild.invites.cache.first();

  if (invite?.code) {
    Main.inviteDataCache.set(guildId, {
      code: invite.code,
      inviteChannelId: invite.channel.id,
    });
    logger.verbose(`generated invite code: ${invite?.code}`);
    return {
      code: invite.code,
    };
  }

  let channelId: string;
  if (guild.channels.cache.find((c) => c.id === inviteChannelId)) {
    channelId = inviteChannelId;
  } else {
    logger.warn(
      `Invite channel ${inviteChannelId} does not exist in server ${guildId}`
    );

    const publicChannel = guild.channels.cache.find(
      (c) =>
        c.isText() &&
        !(c as any).permissionOverwrites?.cache.some(
          (po: PermissionOverwrites) =>
            po.id === guild.roles.everyone.id && po.deny.any("VIEW_CHANNEL")
        )
    );
    if (publicChannel) {
      channelId = publicChannel.id;
    } else {
      logger.warn(`Cannot find public channel in ${guildId}`);
      channelId = guild.channels.cache.find((c) => c.isText())?.id;
    }
  }

  const newInvite = await guild.invites.create(channelId, { maxAge: 0 });
  logger.verbose(`generated invite code: ${newInvite?.code}`);
  Main.inviteDataCache.set(guildId, {
    code: newInvite.code,
    inviteChannelId: channelId,
  });
  return {
    code: newInvite.code,
  };
};

const isMember = async (
  guildId: string,
  userId: string
): Promise<UserResult> => {
  const guild = await Main.Client.guilds.fetch(guildId);

  const member = await guild.members.fetch(userId);

  return getUserResult(member);
};

const removeUser = async (guildId: string, userId: string): Promise<void> => {
  const guild = await Main.Client.guilds.fetch(guildId);

  const member = await guild.members.fetch(userId);

  await member.kick();
};

const createChannel = async (params: CreateChannelParams) => {
  logger.verbose(`createChannel params: ${JSON.stringify(params)}`);
  const { guildId, channelName } = params;
  const guild = await Main.Client.guilds.fetch(guildId);

  const createdChannel = await guild.channels.create(channelName, {
    type: "GUILD_TEXT",
    permissionOverwrites: [
      { type: "role", id: guild.roles.everyone.id, deny: "SEND_MESSAGES" },
    ],
  });

  return createdChannel;
};

const deleteRole = async (guildId: string, roleId: string): Promise<Role> => {
  const guild = await Main.Client.guilds.fetch(guildId);
  const deletedRole = guild.roles.cache.find((r) => r.id === roleId).delete();
  return deletedRole;
};

const deleteChannel = async (
  guildId: string,
  channelId: string
): Promise<Channel> => {
  const guild = await Main.Client.guilds.fetch(guildId);
  const deletedChannel = guild.channels.cache
    .find((r) => r.id === channelId)
    .delete();
  return deletedChannel;
};

const deleteChannelAndRole = async (
  params: DeleteChannelAndRoleParams
): Promise<boolean> => {
  logger.verbose(`deleteChannelAndRole params: ${JSON.stringify(params)}`);
  const { guildId, roleId, channelId } = params;

  try {
    await deleteRole(guildId, roleId);
    await deleteChannel(guildId, channelId);
    return true;
  } catch (error) {
    logger.error(getErrorResult(error));
    return false;
  }
};

const createRole = async (
  serverId: string,
  roleName: string,
  isGuard: boolean,
  entryChannelId?: string
) => {
  logger.verbose(`createRole params: ${serverId}, ${roleName}`);
  const guild = await Main.Client.guilds.fetch(serverId);

  const role = await guild.roles.create({
    name: roleName,
    hoist: true,
    reason: `Created by ${Main.Client.user.username} for a Guild role.`,
    permissions: Permissions.FLAGS.VIEW_CHANNEL,
  });
  logger.verbose(`role created: ${role.id}`);

  if (isGuard) {
    await denyViewEntryChannelForRole(role, entryChannelId);
  }

  return role.id;
};

const updateRoleName = async (
  serverId: string,
  roleId: string,
  newRoleName: string,
  isGuarded: boolean,
  entryChannelId?: string
) => {
  logger.verbose(
    `updateRoleName params: ${serverId}, ${roleId}, ${newRoleName}`
  );
  const guild = await Main.Client.guilds.fetch(serverId);

  const role = await guild.roles.fetch(roleId);

  const updatedRole = await role.edit(
    {
      name: newRoleName,
      permissions: isGuarded ? role.permissions.add("VIEW_CHANNEL") : undefined,
    },
    `Updated by ${Main.Client.user.username} because the role name has changed in Guild.`
  );

  if (isGuarded) {
    denyViewEntryChannelForRole(role, entryChannelId);
  }

  return updatedRole;
};

const isIn = async (guildId: string): Promise<boolean> => {
  logger.verbose(`isIn params: ${guildId}`);

  try {
    await Main.Client.guilds.fetch(guildId);
    logger.verbose("isIn: true");
    return true;
  } catch (error) {
    if (error.code === 50001) {
      logger.verbose("isIn: false");
      return false;
    }
    logger.verbose("isIn: error");
    throw error;
  }
};

// eslint-disable-next-line no-unused-vars
const getServerInfo = async (guildId: string, includeDetails: boolean) => {
  logger.verbose(`listChannels params: ${guildId}`);
  // TODO rethink includeDetails & isAdmin property
  try {
    const guild = await Main.Client.guilds.fetch(guildId);
    const { icon: iconId, name: serverName } = guild;
    const serverIcon =
      iconId === null
        ? ""
        : `https://cdn.discordapp.com/icons/${guildId}/${iconId}.png`;

    if (
      !guild.me.permissions.has(Permissions.FLAGS.ADMINISTRATOR) &&
      !guild.me.permissions.has(Permissions.FLAGS.MANAGE_ROLES)
    ) {
      return {
        serverIcon,
        serverName,
        serverId: guildId,
        channels: [],
        roles: [],
        isAdmin: false,
      };
    }

    const roles: Collection<string, Role> = guild?.roles.cache.filter(
      (r) => r.id !== guild.roles.everyone.id
    );

    const channels = guild?.channels.cache
      .filter(
        (c) =>
          c.type === "GUILD_TEXT" &&
          c
            .permissionsFor(guild.roles.everyone)
            .has(Permissions.FLAGS.VIEW_CHANNEL)
      )
      .map((c) => ({
        id: c?.id,
        name: c?.name,
      }));

    const categories: any[] = getChannelsByCategoryWithRoles(guild);

    const membersWithoutRole = guild.members.cache.reduce(
      (acc, m) =>
        m.roles.highest.id === guild.roles.everyone.id ? acc + 1 : acc,
      0
    );

    return {
      serverIcon,
      serverName,
      serverId: guildId,
      categories,
      roles,
      isAdmin: true,
      membersWithoutRole,
      channels,
    };
  } catch (error) {
    return {
      serverIcon: "",
      serverName: "",
      serverId: guildId,
      channels: [],
      roles: [],
      isAdmin: null,
      membersWithoutRole: null,
    };
  }
};

const listAdministeredServers = async (userId: string) => {
  logger.verbose(`listAdministeredServers params: ${userId}`);

  const administeredServers = Main.Client.guilds.cache
    .filter((g) =>
      g.members.cache.get(userId)?.permissions.has("ADMINISTRATOR")
    )
    .map((g) => ({ name: g.name, id: g.id }));

  logger.verbose(`listAdministeredServers result: ${administeredServers}`);
  return administeredServers;
};

const getGuild = async (guildId: string) => {
  if (DiscordServerNames[guildId]) {
    return DiscordServerNames[guildId];
  }
  const guild = await Main.Client.guilds.fetch(guildId);
  DiscordServerNames[guildId] = guild.name as any;
  return guild.name;
};

const getRole = async (guildId: string, roleId: string) => {
  const guild = await Main.Client.guilds.fetch(guildId);
  const role = guild.roles.cache.find((r) => r.id === roleId);
  return { serverName: guild.name, roleName: role.name };
};

const getUserPoap = async (
  userId: string,
  guildId: string
): Promise<MessageOptions> => {
  try {
    const guild = await getGuildOfServer(guildId);
    const poapLinks = await Promise.all(
      guild?.poaps?.map(async (poap) => {
        try {
          const response = await axios.post(
            `${config.backendUrl}/assets/poap/claim`,
            {
              userId,
              // eslint-disable-next-line no-unsafe-optional-chaining
              poapId: poap.poapIdentifier,
            }
          );
          return new MessageButton({
            label: `Claim ${poap.fancyId}`,
            style: "LINK",
            url: response.data,
          });
        } catch (err: any) {
          const errorMessage = getBackendErrorMessage(err);
          logger.warn(`poapClaim - ${userId} ${errorMessage}`);

          if (
            errorMessage.includes(
              "expired" || "claimable" || "join" || "transaction"
            )
          ) {
            return null;
          }

          return new MessageButton({
            label: `Buy ${poap.fancyId}`,
            style: "LINK",
            url: `https://guild.xyz/${guild.urlName}/claim-poap/${poap.fancyId}`,
          });
        }
      })
    );

    const contentMessage =
      guild?.poaps?.length > 1
        ? "These are **your** links"
        : "This is **your** link";

    return {
      components: [
        new MessageActionRow({ components: poapLinks.filter((p) => p?.url) }),
      ],
      content: `${contentMessage} to your POAP(s). Do **NOT** share it with anyone!`,
    };
  } catch (err: any) {
    const errorMessage = getBackendErrorMessage(err);

    if (errorMessage) {
      logger.verbose(`getUserPoap error: ${errorMessage}`);
      return {
        content: errorMessage,
      };
    }
    logger.verbose(`getUserPoap error: ${err.message}`);

    return {
      content: `Unfortunately, you couldn't claim this POAP right now. Check back later!`,
    };
  }
};

const sendDiscordButton = async (
  guildId: string,
  channelId: string,
  meta?: ButtonMetaData
) => {
  const guild = await Main.Client.guilds.fetch(guildId);
  const channel = guild.channels.cache.find((c) => c.id === channelId);

  if (!channel?.isText()) {
    return false;
  }

  const guildOfServer = await getGuildOfServer(guildId);
  const payload = createInteractionPayload(
    guildOfServer,
    meta?.title,
    meta?.description,
    meta?.button,
    meta?.isJoinButton
  );

  const message = await channel.send(payload);
  await message.react(config.joinButtonEmojis.emoji1);
  await message.react(config.joinButtonEmojis.emoji2);

  return true;
};

const getUser = async (userId: string) => Main.Client.users.fetch(userId);

const manageMigratedActions = async (
  guildId: string,
  upgradeableUserIds: string[],
  downgradeableUserIds: string[] | "ALL",
  roleId: string,
  message: string
) => {
  const guild = await Main.Client.guilds.fetch(guildId);
  const role = guild.roles.cache.find((r) => r.id === roleId);
  await Promise.all(
    upgradeableUserIds.map(async (id) => {
      const member = await guild.members.fetch(id);
      await member.roles.add(roleId);
      await notifyAccessedChannels(member, roleId, message);
    })
  );

  const membersToTakeRoleFrom = role.members.filter(
    downgradeableUserIds === "ALL"
      ? (member) => !upgradeableUserIds.includes(member.id)
      : (member) => downgradeableUserIds.includes(member.id)
  );

  await Promise.all(
    membersToTakeRoleFrom.map(async (m) => {
      if (!upgradeableUserIds.includes(m.id)) {
        await m.roles.remove(roleId);
        const embed = new MessageEmbed({
          title: `You no longer have access to the \`${message}\` role in \`${guild.name}\`, because you have not fulfilled the requirements, disconnected your Discord account or just left it.`,
          color: `#${config.embedColor}`,
        });
        try {
          await m.send({ embeds: [embed] });
        } catch (error) {
          if (error?.code === 50007) {
            logger.verbose(
              `Cannot send messages to ${m.user.username}#${m.user.discriminator}`
            );
          } else {
            logger.error(JSON.stringify(error));
          }
        }
      }
    })
  );
};

const setupGuildGuard = async (
  guildId: string,
  entryChannelId?: string,
  roleIds?: string[]
) => {
  logger.verbose(
    `Setting up guild guard, server: ${guildId}, entryChannelId: ${entryChannelId}`
  );

  const guild = await Main.Client.guilds.fetch(guildId);

  const editReason = `Updated by ${Main.Client.user.username} because Guild Guard has been enabled.`;
  let createdEntryChannelId: string;

  const editableRolesExceptEveryone = guild.roles.cache.filter(
    (r) => r.id !== guild.roles.everyone.id && r.editable
  );

  let verifiedRoles: Collection<string, Role>;
  if (roleIds) {
    verifiedRoles = guild.roles.cache.filter((r) => roleIds.includes(r.id));
  } else {
    verifiedRoles = editableRolesExceptEveryone;
  }

  // check if enrty channel id was provided
  if (entryChannelId && entryChannelId !== "0") {
    // check if the provided entry channel is valid
    const existingChannel = guild.channels.cache.find(
      (c) => c.id === entryChannelId
    );

    if (!existingChannel) {
      throw new Error(
        `Channel with id ${entryChannelId} does not exists in server ${guildId}.`
      );
    }

    if (existingChannel instanceof ThreadChannel) {
      throw Error("Entry channel cannot be a thread.");
    }

    if (existingChannel.type === "GUILD_VOICE") {
      throw Error("Entry channel cannot be a voice channel.");
    }

    // check if read permission is allowed for everyone in the enrty channel
    if (
      !existingChannel.permissionOverwrites.cache
        .get(guild.roles.everyone.id)
        ?.allow.has(Permissions.FLAGS.VIEW_CHANNEL)
    ) {
      await existingChannel.permissionOverwrites.create(guild.roles.everyone, {
        VIEW_CHANNEL: true,
        READ_MESSAGE_HISTORY: true,
        SEND_MESSAGES: false,
      });
    }

    Promise.all(
      verifiedRoles.map(async (r) => {
        if (
          !existingChannel.permissionOverwrites.cache
            .get(r.id)
            ?.deny.has(Permissions.FLAGS.VIEW_CHANNEL)
        )
          await existingChannel.permissionOverwrites.create(
            r,
            { VIEW_CHANNEL: false },
            { reason: editReason }
          );
      })
    );

    logger.verbose(
      `Entry channel created from existing channel in ${guild.id}`
    );
  } else {
    // create entry channel with the proper permission overwrited
    const createdEntryChannel = await guild.channels.create("entry-channel", {
      permissionOverwrites: [
        {
          type: "role",
          id: guild.roles.everyone.id,
          allow: "VIEW_CHANNEL",
          deny: "SEND_MESSAGES",
        },
        ...verifiedRoles.map<OverwriteResolvable>((r) => ({
          type: "role",
          id: r.id,
          deny: "VIEW_CHANNEL",
        })),
      ],
      reason: `Created by ${Main.Client.user.username} because Guild Guard has been enabled.`,
    });
    createdEntryChannelId = createdEntryChannel.id;

    logger.verbose(`Entry channel created for ${guild.id}`);
  }

  await Promise.all(
    verifiedRoles.map(async (r) => {
      await r.edit({ permissions: r.permissions.add("VIEW_CHANNEL") });
    })
  );

  if (roleIds) {
    await Promise.all(
      editableRolesExceptEveryone.difference(verifiedRoles).map(async (r) => {
        await r.edit({ permissions: r.permissions.remove("VIEW_CHANNEL") });
      })
    );
  }

  // make sure the @everyone role has no view channel permission
  await guild.roles.everyone.edit(
    {
      permissions: guild.roles.everyone.permissions.remove(
        Permissions.FLAGS.VIEW_CHANNEL
      ),
    },
    editReason
  );

  return createdEntryChannelId;
};

const resetGuildGuard = async (guildId: string, entryChannelId: string) => {
  logger.verbose(`Resetting guild guard, server: ${guildId}`);

  const guild = await Main.Client.guilds.fetch(guildId);
  const entryChannel = guild.channels.cache.get(entryChannelId);
  if (!entryChannel) {
    throw new Error(
      `Channel with id ${entryChannelId} does not exists in server ${guildId}.`
    );
  }

  if (entryChannel instanceof ThreadChannel) {
    throw Error("Entry channel cannot be a thread.");
  }

  if (entryChannel.type === "GUILD_VOICE") {
    throw Error("Entry channel cannot be a voice channel.");
  }

  const editReason = `Updated by ${Main.Client.user.username} because Guild Guard has been disabled.`;

  await entryChannel.permissionOverwrites.delete(
    guild.roles.everyone.id,
    editReason
  );

  await Promise.all(
    guild.roles.cache
      .filter((role) => !role.permissions.has("VIEW_CHANNEL"))
      .map((role) =>
        role.edit({ permissions: role.permissions.add("VIEW_CHANNEL") })
      )
  );

  await guild.roles.everyone.edit(
    {
      permissions: guild.roles.everyone.permissions.add("VIEW_CHANNEL"),
    },
    editReason
  );
};

const getMembersByRoleId = async (serverId: string, roleId: string) => {
  const server = await Main.Client.guilds.fetch(serverId);

  const role = await server.roles.fetch(roleId);

  return [...role.members.keys()] || [];
};

const sendPollMessage = async (
  channelId: string,
  poll: Poll
): Promise<number> => {
  const { id, question } = poll;

  const channel = (await Main.Client.channels.fetch(channelId)) as TextChannel;

  const embed = new MessageEmbed({
    title: `Poll #${id}: ${question}`,
    color: `#${config.embedColor}`,
    description: await createPollText(poll),
  });

  const msg = await channel.send({ embeds: [embed] });

  poll.reactions.map(async (emoji) => await (msg as Message).react(emoji));

  return +msg.id;
};

const getEmoteList = async (guildId: string): Promise<Emote[]> => {
  const guild = await Main.Client.guilds.fetch(guildId);
  const emotes = await guild.emojis.fetch();

  return emotes.map((emote) => ({
    name: emote.name,
    id: emote.id,
    image: emote.url,
    animated: emote.animated,
  }));
};

const getChannelList = async (guildId: string): Promise<ChannelObj[]> => {
  const guild = await Main.Client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();

  return channels
    .filter((channel) => !channel.type.match(/^GUILD_(CATEGORY|VOICE)$/))
    .map((channel) => ({
      name: channel.name,
      id: channel.id,
    }));
};

export {
  getMembersByRoleId,
  manageRoles,
  manageMigratedActions,
  generateInvite,
  isMember,
  removeUser,
  createRole,
  updateRoleName,
  isIn,
  getServerInfo,
  listAdministeredServers,
  createChannel,
  getGuild,
  getRole,
  deleteChannelAndRole,
  deleteRole,
  sendDiscordButton,
  getUser,
  setupGuildGuard,
  sendPollMessage,
  getEmoteList,
  getChannelList,
  resetGuildGuard,
  getUserPoap,
};
