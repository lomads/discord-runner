type ManageRolesParams = {
  guildId: string;
  platformUserId: string;
  roleId: string;
  message: string;
};

type CreateChannelParams = {
  guildId: string;
  channelName: string;
};

type DeleteChannelAndRoleParams = {
  guildId: string;
  roleId: string;
  channelId: string;
};

type UserResult = {
  username: string;
  discriminator: string;
  avatar: string;
  roles: string[];
};

type InviteResult = {
  code: string;
};

type ErrorResult = {
  errors: { msg: string; value: string[] }[];
};

class ActionError extends Error {
  ids: string[];

  constructor(message: string, ids: string[]) {
    super(message);
    this.ids = ids;
  }
}

type CreateRoleResult = {
  id: string;
};

type DiscordChannel = {
  id: string;
  name: string;
};

type LevelInfo = {
  name: string;
  discordServerId: string;
  accessedRoles: string;
};

type InviteData = {
  code: string;
  inviteChannelId: string;
};

type SelectMenuOption = {
  label: string;
  description: string;
  value: string;
};

type NewPoll = {
  roles: SelectMenuOption[];
  requirements: SelectMenuOption[];
  requirementId: number;
  channelId: string;
  question: string;
  options: string[];
  reactions: string[];
  expDate: string;
};

type Poll = {
  id: number;
  question: string;
  startDate: number;
  expDate: number;
  options: string[];
  reactions: string[];
};

type Reaction = {
  name: string;
  users: string[];
};

type Vote = {
  platform: "DISCORD" | "TELEGRAM";
  pollId: number;
  platformUserId: string;
  optionIndex: number;
};
type ButtonMetaData = Partial<{
  title: string;
  description: string;
  button: string;
  isJoinButton: boolean;
}>;

type Platform = {
  id: number;
  isGuarded: boolean;
  platformId: string;
  type: string;
  platformName: string;
};

type Role = {
  id: number;
  name: string;
  platforms: {
    roleId: number;
    platformId: number;
    inviteChannel: string;
    discordRoleId: string;
  }[];
};

type GuildOfServer = {
  id: number;
  name: string;
  urlName: string;
  description: string;
  imageUrl: string;
  platforms: Platform[];
  roles: Role[];
  poaps: any[];
};

type Emote = {
  name: string;
  id: string;
  image: string;
  animated: boolean;
};

type ChannelObj = {
  name: string;
  id: string;
};

export {
  ButtonMetaData,
  ManageRolesParams,
  CreateChannelParams,
  DeleteChannelAndRoleParams,
  UserResult,
  InviteResult,
  ErrorResult,
  ActionError,
  CreateRoleResult,
  DiscordChannel,
  LevelInfo,
  InviteData,
  SelectMenuOption,
  NewPoll,
  Poll,
  Reaction,
  Vote,
  GuildOfServer,
  Emote,
  ChannelObj,
};
