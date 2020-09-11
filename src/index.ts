import fetch from "simple-better-fetch";

interface TwitchApiOptions {
	clientId?: string;
	authorizationKey?: string;
	clientSecret?: string;
	kraken?: boolean;
}

interface FetchOptions {
	method?: string;
	headers?: object;
	body?: string;
}

interface BTTVEmote {
	code: string;
	id: string;
}

interface FFZEmote {
	name: string;
	urls: object;
}

class TwitchApi {
	private clientId?: string;
	private authorizationKey?: string;
	private clientSecret?: string;
	private kraken: boolean;
	constructor(private options: TwitchApiOptions) {
		if (!options) {
			throw new Error("missing options");
		}
		this.clientId = options.clientId;
		this.authorizationKey = options.authorizationKey;
		this.clientSecret = options.clientSecret;
		this.kraken = !!options.kraken;
	}

	get isUnAuthenticated() {
		return this.clientId == undefined || this.authorizationKey == undefined;
	}

	get copy() {
		return new TwitchApi({
			clientId: this.clientId,
			authorizationKey: this.authorizationKey,
			clientSecret: this.clientSecret,
			kraken: this.kraken,
		});
	}

	async fetch(url: string, fetchOptions?: FetchOptions) {
		if (!fetchOptions) fetchOptions = {};
		const { method, body, headers } = fetchOptions;
		const options =
			method === "POST"
				? {
						method: method || "GET",
						headers: {
							"Client-ID": this.clientId || "",
							Authorization: `${this.kraken ? "OAuth" : "Bearer"} ${this.authorizationKey}`,
							...(headers || {}),
							...(this.kraken ? { Accept: "application/vnd.twitchtv.v5+json" } : {}),
						},
						body: body || "",
				  }
				: {
						method: method || "GET",
						headers: {
							"Client-ID": this.clientId || "",
							Authorization: `${this.kraken ? "OAuth" : "Bearer"} ${this.authorizationKey}`,
							...(headers || {}),
							...(this.kraken ? { Accept: "application/vnd.twitchtv.v5+json" } : {}),
						},
				  };
		try {
			const json = await fetch(url, options);
			return json;
		} catch (err) {
			// TODO add a better handler
			throw err;
		}
	}

	async fetchModChannels(username: string) {
		let modApiUrl = `https://modlookup.3v.fi/api/user-v3/${username}`;
		let response = await this.fetch(modApiUrl);
		let channels = response.channels;
		try {
			while (response.cursor) {
				modApiUrl = `https://modlookup.3v.fi/api/user-v3/${username}?cursor=${response.cursor}`;
				response = await this.fetch(modApiUrl);
				channels = [...channels, ...response.channels];
			}
		} catch (err) {}
		return channels;
	}

	async getUserModerationChannels(username: string, convert?: boolean) {
		const channels = await this.fetchModChannels(username);
		if (this.isUnAuthenticated || !convert) {
			return channels;
		} else {
			const ModChannels = await Promise.all(channels.map(async (channel: any) => this.getUserInfo(channel.name)));
			return ModChannels;
		}
	}

	async getUserModerators(username: string) {
		const userInfo = await this.getUserInfo(username);
		const userId = userInfo.id;
		const apiURL = `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${userId}`;
		const response = await this.fetch(apiURL);
		return response.data[0];
	}

	async getUserInfo(username: string) {
		if (this.isUnAuthenticated) {
			throw new Error("Missing either your clientId or Authorization Key");
		}
		let key = "login";
		if (username.replace(/\d/g, "") === "") key = "id";
		const apiURL = `https://api.twitch.tv/helix/users?${key}=${username}`;
		const response = await this.fetch(apiURL);
		return response.data[0];
	}

	async getBadgesByUsername(username: string) {
		const userInfo = await this.getUserInfo(username);
		const userId = userInfo.id;
		return this.getBadgesById(userId);
	}

	async getBadgesById(userId: string) {
		const customBadgeURL = `https://badges.twitch.tv/v1/badges/channels/${userId}/display`;
		const response = await this.fetch(customBadgeURL);
		return response.badge_sets;
	}

	async getGlobalBadges() {
		const globalBadgeResponse = await this.fetch("https://badges.twitch.tv/v1/badges/global/display");
		return globalBadgeResponse.badge_sets;
	}

	async refreshToken(refreshToken: string, clientSecret?: string) {
		if (!this.clientId || (!this.clientSecret && !clientSecret)) {
			throw new Error("Missing client id or client secret required to refresh a refresh token");
		}
		const apiURL = `https://id.twitch.tv/oauth2/token?client_id=${this.clientId}&client_secret=${
			this.clientSecret || clientSecret
		}&grant_type=refresh_token&refresh_token=${refreshToken}`;
		return await this.fetch(apiURL, { method: "POST" });
	}

	async getBttvEmotes(channelName: string) {
		const bttvEmotes: any = {};
		let bttvRegex;
		const bttvResponse = await fetch("https://api.betterttv.net/2/emotes");
		let { emotes } = await bttvResponse.json();
		// replace with your channel url
		const bttvChannelResponse = await fetch(`https://api.betterttv.net/2/channels/${channelName}`);
		const { emotes: channelEmotes } = await bttvChannelResponse.json();
		if (channelEmotes) {
			emotes = emotes.concat(channelEmotes);
		}
		let regexStr = "";
		emotes.forEach(({ code, id }: BTTVEmote, i: number) => {
			bttvEmotes[code] = id;
			regexStr += code.replace(/\(/, "\\(").replace(/\)/, "\\)") + (i === emotes.length - 1 ? "" : "|");
		});
		bttvRegex = new RegExp(`(?<=^|\\s)(${regexStr})(?=$|\\s)`, "g");

		return { bttvEmotes, bttvRegex };
	}

	async getFfzEmotes(channelName: string) {
		const ffzEmotes: any = {};
		let ffzRegex;

		const ffzResponse = await fetch("https://api.frankerfacez.com/v1/set/global");
		// replace with your channel url
		const ffzChannelResponse = await fetch(`https://api.frankerfacez.com/v1/room/${channelName}`);
		const { sets } = await ffzResponse.json();
		const { room, sets: channelSets } = await ffzChannelResponse.json();
		let regexStr = "";
		const appendEmotes = ({ name, urls }: FFZEmote, i: number, emotes: object[]) => {
			ffzEmotes[name] = `https:${Object.values(urls).pop()}`;
			regexStr += name + (i === emotes.length - 1 ? "" : "|");
		};
		sets[3].emoticons.forEach(appendEmotes);
		if (channelSets && room) {
			const setnum = room.set;
			channelSets[setnum].emoticons.forEach(appendEmotes);
		}
		ffzRegex = new RegExp(`(?<=^|\\s)(${regexStr})(?=$|\\s)`, "g");
		return { ffzEmotes, ffzRegex };
	}

	async getCheerMotes(broadcaster_id?: string) {
		const query = broadcaster_id ? `?broadcaster_id=${broadcaster_id}` : "";
		const CheerMotes = (await this.fetch(`https://api.twitch.tv/helix/bits/cheermotes${query}`)).data;
		return CheerMotes;
	}

	parseEmotes = (message: string, emotes: any) => {
		const emoteIds = Object.keys(emotes);
		const emoteStart = emoteIds.reduce((starts: any, id) => {
			emotes[id].forEach(
				(startEnd: { split: (arg0: string) => { (): any; new (): any; map: { (arg0: NumberConstructor): [any, any]; new (): any } } }) => {
					const [start, end] = startEnd.split("-").map(Number);
					starts[start] = {
						emoteUrl: `<img src="https://static-cdn.jtvnw.net/emoticons/v1/${id}/3.0" class="emote"`,
						end: end,
					};
				}
			);
			return starts;
		}, {});
		const parts = Array.from(message);
		const emoteNames: any = {};
		let extraCharacters = 0;
		for (let i = 0; i < parts.length; i++) {
			const emoteInfo = emoteStart[i];
			extraCharacters += parts[i].length - 1;
			if (emoteInfo) {
				const name: string = message.slice(i + extraCharacters, emoteInfo.end + 1 + extraCharacters);
				emoteNames[name] = `${emoteInfo.emoteUrl} title="${name}">`;
			}
		}
		return emoteNames;
	};
}

module.exports = TwitchApi;
