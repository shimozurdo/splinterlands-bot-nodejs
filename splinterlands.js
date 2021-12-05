const hive = require('@hiveio/hive-js');
const fetch = require('node-fetch');
const WSocket = require('./wsocket.js');
const Transaction = require('./transaction.js');
const Utils = require('./utils.js');
const eosjs_ecc = require('eosjs-ecc');
const Match = require('./match.js');
const util = require('util');
class Splinterlands {
	constructor(config) {
		this._config = config;
		this._server_time_offset = 0;
		this._settings = {};
		this._transactions = {};
		this._utils = new Utils(this);
		this._players = [];
	}

	async init() {
		if (!this._config.ec_api_url)
			this._config.ec_api_url = "https://ec-api.splinterlands.com"

		hive.api.setOptions({ transport: 'http', uri: 'https://api.hive.blog', url: 'https://api.hive.blog' });

		await this.load_settings();
	}

	async load_settings() {
		let response = await this.api('/settings');

		if (this.get_settings().version && this.get_settings().version != response.version) {
			// new version splinterlands
			this.version_change = response.version;
		}

		this._settings = response;
	}

	get_settings() {
		return this._settings;
	}

	get_config() {
		return this._config;
	}

	is_player_logued(playerName) {
		const loguedPlayer = this._players.find(p => p.name === playerName);
		//console.log("** check login user", loguedPlayer ? loguedPlayer.socket ? !loguedPlayer.socket._connected ? "** error disconnect: " + loguedPlayer.socket._connected : "still connected" : "no conected" : "No hay user");
		if (loguedPlayer && loguedPlayer.socket && loguedPlayer.socket._connected)
			return true;
		else
			return false;
	}

	async player_login(playerName, key) {
		let params = { name: playerName, ts: Date.now() };
		params.sig = eosjs_ecc.sign(playerName + params.ts, key);
		// Get the encrypted access token from the server
		let response = await this.api('/players/login', params);
		//console.log("** Response login: ", response.name, "error", response.error ? response.error : "none");
		if (!response || response.error)
			throw new Error(response)

		let newPlayer = { name: playerName, postingKey: key }
		Object.keys(response).forEach(k => newPlayer[k] = response[k]);

		const index = this._players.indexOf(p => p.name === playerName);

		if (~index) {
			this._players[index] = newPlayer;
		} else
			this._players.push(newPlayer);
		const loguedPlayer = this._players.find(p => p.name === playerName);
		loguedPlayer.socket = new WSocket(this.get_config().ws_url, playerName, this);
	}

	wait_for_player_login(playerName/*, timeout = 1000*/) {
		return new Promise((resolve/*, reject*/) => {			// if (loguedPlayer.socket._connected) {
			// 	resolve({ success: true });
			// 	return;
			// }
			const loguedPlayer = this._players.find(p => p.name === playerName);

			loguedPlayer.on_login = resolve;
			//console.log("** before asign reolve login", loguedPlayer.name, loguedPlayer.on_login)
			// loguedPlayer.on_login_timeout = setTimeout(() => {
			// 	// if (loguedPlayer.socket)
			// 	// 	loguedPlayer.socket._connected = false;
			// 	console.log("** socket disconnect");
			// 	reject({ success: false, error: `The player ${loguedPlayer.name} could not login` });
			// }, timeout);
		});
	}

	async find_match(match_type, playerName, opponent, settings) {
		const loguedPlayer = this._players.find(p => p.name === playerName);
		if (loguedPlayer) {
			return this.send_tx_wrapper('find_match', 'Find Match', { match_type, opponent, settings }, loguedPlayer, tx => {
				return this.set_match({ id: tx.id, status: 0 }, loguedPlayer);
			});
		} else
			throw new Error("Player not logued")
	}

	set_match(match_data, player) {
		player.match = player.match ? player.match.update(match_data) : new Match(match_data, this);
		return player.match;
	}

	wait_for_match(_match) {
		return new Promise((resolve, reject) => {
			if (!_match) {
				reject({ error: 'Player is not currently looking for a match.', code: 'not_looking_for_match' });
				return;
			}

			// Player has already been matched with an opponent
			if (_match.status == 1) {
				resolve(_match);
				return;
			}

			_match.on_match = resolve;
			_match.on_timeout = reject;
		});
	}

	async submit_team(match, summoner, monsters, playerName, secret) {
		if (!secret)
			secret = this._utils.random_str(10);

		const loguedPlayer = this._players.find(p => p.name === playerName);

		let data = { trx_id: match.id, team_hash: this._utils.md5(summoner, monsters, secret) };

		return this.send_tx_wrapper('submit_team', 'Submit Team', data, loguedPlayer, async tx => {
			let cur_match = match;

			if (cur_match && cur_match.id == match.id) {
				// If the opponent already submitted their team, then we can reveal ours
				//console.log("** opponent team hash", cur_match.opponent_team_hash)
				if (cur_match.opponent_team_hash)
					return await this.team_reveal(cur_match.id, summoner, monsters, secret, loguedPlayer);

				// If the opponent has not submitted their team, then queue up the team reveal operation for when they do
				cur_match.on_opponent_submit = async () => await this.team_reveal(cur_match.id, summoner, monsters, secret, loguedPlayer);

				// Save the team info locally in case the game is refreshed or something and it needs to be resubmitted later
				// if (!cur_match.resubmit_battle)
				// 	cur_match.resubmit_battle = {};
				// cur_match.resubmit_battle[cur_match.id] = JSON.stringify({ summoner, monsters, secret });
				//console.log("** resubmit add", cur_match.resubmit_battle);
			}

			return tx;
		});
	}

	wait_for_result(_match) {
		return new Promise((resolve, reject) => {
			if (!_match) {
				reject({ error: 'Player is not currently in a match.', code: 'not_in_match' });
				return;
			}

			// The battle is already resolved
			if (_match.status == 2) {
				resolve(_match);
				return;
			}

			_match.on_result = resolve;
			_match.on_timeout = reject;
		});
	}

	async team_reveal(trx_id, summoner, monsters, secret, loguedPlayer) {
		// if (!summoner) {
		// 	// If no summoner is specified, check if the team info is saved in local storage
		// 	let saved_team = null;
		// 	if (loguedPlayer.match)
		// 		saved_team = this._utils.try_parse(loguedPlayer.match.resubmit_battle[trx_id]);
		// 	console.log("** there is no summoner", saved_team);
		// 	if (saved_team) {
		// 		summoner = saved_team.summoner;
		// 		monsters = saved_team.monsters;
		// 		secret = saved_team.secret;
		// 	}
		// }

		return this.send_tx_wrapper('team_reveal', 'Team Reveal', { trx_id, summoner, monsters, secret }, loguedPlayer, res => {
			//console.log("** resubmit 1", loguedPlayer ? loguedPlayer.match ? loguedPlayer.match.resubmit_battle : " no match" : "No hay resubmit");
			// Clear any team info saved in local storage after it is revealed
			if (loguedPlayer.match)
				loguedPlayer.match.resubmit_battle = null;
			//console.log("** resubmit 2", loguedPlayer.match.resubmit_battle);
			return res;
		});
	}

	async send_tx_wrapper(id, display_name, data, player, on_success) {
		return new Promise((resolve, reject) => {
			this.send_tx(id, display_name, data, player).then(async result => {
				// If there is any type of error, just return the result object
				if (!result || !result.trx_info || !result.trx_info.success || result.error) {
					if (result && result.error.includes("The specified battle has already been resolved")) {
						console.log(util.inspect(result))
						console.log(`** @${player.name} sometimes wrong 'battle has already been resolved'`)
					}
					reject(result);
				}
				else {
					try { resolve(await on_success(new Transaction(result.trx_info, this))); }
					catch (err) { reject(err); }
				}
			});
		});
	}

	async send_tx(id, display_name, data, player) {
		// Only use this method for battle API transactions for now
		if (!this.get_settings().api_ops.includes(id)) {
			return await this.send_tx_old(id, display_name, data, player);
		}

		let active_auth = false;
		id = this._utils.format_tx_id(id);

		try { data = this._utils.format_tx_data(data); }
		catch (err) {
			return { success: false, error: err.toString() };
		}

		let data_str = JSON.stringify(data);

		let tx = {
			operations: [['custom_json', {
				required_auths: active_auth ? [player.name] : [],
				required_posting_auths: active_auth ? [] : [player.name],
				id,
				json: data_str
			}]]
		};

		try {
			// Start waiting for the transaction to be picked up by the server immediately
			let check_tx_promise = this.check_tx(data.sm_id);
			let broadcast_promise = this.server_broadcast_tx(tx, player).then(response => {
				return {
					type: 'broadcast',
					method: 'battle_api',
					success: (response && response.id),
					trx_id: (response && response.id) ? response.id : null,
					error: response.error ? response.error : null
				}
			});

			let result = await Promise.race([check_tx_promise, broadcast_promise]);

			// Check if the transaction was broadcast and picked up by the server before we got the result from the broadcast back
			if (result.type != 'broadcast')
				return result;

			if (result.success) {
				// Wait for the transaction to be picked up by the server
				return await check_tx_promise;
			} else {
				console.log("** Send_tx_old");
				this.clear_pending_tx(data.sm_id);
				return await this.send_tx_old(id, display_name, data, player);
			}
		} catch (err) {
			return await this.send_tx_old(id, display_name, data, player);
		}
	}

	async send_tx_old(id, display_name, data, player, retries) {
		console.log("** Send_tx_old >>>>>>>>>>>>> Check!!");
		if (!retries) retries = 0;

		id = this._utils.format_tx_id(id);

		try { data = this._utils.format_tx_data(data); }
		catch (err) {
			//log_event('tx_length_exceeded', { type: id });
			return { success: false, error: err.toString() };
		}

		let data_str = JSON.stringify(data);

		// Start waiting for the transaction to be picked up by the server immediately
		let check_tx_promise = this.check_tx(data.sm_id);

		let broadcast_promise = null;

		broadcast_promise = new Promise(resolve => hive.broadcast.customJson(player.postingKey, [], [player.name], id, data_str, (err, response) => {
			resolve({
				type: 'broadcast',
				method: 'steem_js',
				success: (response && response.id),
				trx_id: (response && response.id) ? response.id : null,
				error: err ? JSON.stringify(err) : null
			});
		}));

		let result = await Promise.race([check_tx_promise, broadcast_promise]);

		// Check if the transaction was broadcast and picked up by the server before we got the result from the broadcast back
		if (result.type != 'broadcast')
			return result;

		if (result.success) {
			// Wait for the transaction to be picked up by the server
			return await check_tx_promise;
		} else {
			this.clear_pending_tx(data.sm_id);

			if (result.error == 'user_cancel')
				return result;
			else if (result.error.indexOf('Please wait to transact') >= 0) {
				// The account is out of Resource Credits, request an SP delegation
				let delegation_result = await this.api('/players/delegation');

				if (delegation_result && delegation_result.success) {
					// If the delegation succeeded, retry the transaction after 3 seconds
					await this._utils.timeout(3000);
					return await this.send_tx(id, display_name, data, player, retries + 1);
				} else {
					//log_event('delegation_request_failed', { operation: id, error: result.error });
					return "Oops, it looks like you don't have enough Resource Credits to transact on the Steem blockchain. Please contact us on Discord for help! Error: " + result.error;
				}
			} else if (retries < 2) {
				// Try switching to another RPC node
				this._utils.switch_rpc();

				// Retry the transaction after 3 seconds
				await this._utils.timeout(3000);
				return await this.send_tx(id, display_name, data, player, retries + 1);
			} else {
				//log_event('custom_json_failed', { response: JSON.stringify(result) });
				return result;
			}
		}
	}

	check_tx(sm_id, timeout) {
		return new Promise(resolve => {
			this._transactions[sm_id] = { resolve: resolve };

			this._transactions[sm_id].timeout = setTimeout(() => {
				if (this._transactions[sm_id] && this._transactions[sm_id].status != 'complete')
					resolve({ success: false, error: 'Your transaction could not be found. This may be an issue with the game server. Please try refreshing the site to see if the transaction went through.' });

				delete this._transactions[sm_id];
			}, (timeout || 30) * 1000);
		});
	}

	async server_broadcast_tx(tx, player) {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			try {
				let signed_tx = await this.sign_tx(tx, player);

				if (!signed_tx)
					return;

				let op_name = tx.operations[0][1].id.replace(this.get_settings().test_mode ? `${this.get_settings().prefix}sm_` : 'sm_', '');

				if (this.get_settings().api_ops.includes(op_name)) {
					this.battle_api_post(`/battle/battle_tx`, { signed_tx: JSON.stringify(signed_tx) }, player).then(resolve).catch(reject);
					return;
				}

				// TODO: Get broadcast API stuff working
				//let bcast_url = Config.tx_broadcast_urls[Math.floor(Math.random() * Config.tx_broadcast_urls.length)];
				//api_post(`${bcast_url}/send`, { signed_tx: JSON.stringify(signed_tx) }, resolve).fail(reject);
				resolve({ error: `Unsupported server broadcast operation.` });
			} catch (err) { reject(err); }
		});
	}

	async sign_tx(tx, player) {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			try {
				if (!tx.expiration)
					tx = this.prepare_tx(tx);

				let signed_tx = null;

				let key = player.postingKey

				if (!key)
					return reject({ error: 'Key not found.' });

				signed_tx = hive.auth.signTransaction(tx, [key]);

				signed_tx.expiration = signed_tx.expiration.split('.')[0];
				resolve(signed_tx);
			} catch (err) { reject(err); }
		});
	}

	prepare_tx(tx) {
		return Object.assign({
			ref_block_num: this.get_settings().chain_props.ref_block_num & 0xFFFF,
			ref_block_prefix: this.get_settings().chain_props.ref_block_prefix,
			expiration: new Date(
				new Date(this.get_settings().chain_props.time + 'Z').getTime() +
				600 * 1000
			),
		}, tx);
	}

	clear_pending_tx(sm_id) {
		let tx = this._transactions[sm_id];

		if (tx) {
			clearTimeout(tx.timeout);
			delete this._transactions[sm_id];
		}
	}

	api(url, data) {
		return new Promise((resolve, reject) => {
			if (data == null || data == undefined) data = {};

			// Add a dummy timestamp parameter to prevent IE from caching the requests.
			data.v = new Date().getTime();

			const urlApi = this._config.api_url + url + '?' + this._utils.param(data);
			fetch(urlApi, { method: 'GET' })
				.then(response => {
					if (response.ok)
						return response.json();
					else {
						reject(`Request failed (${url})`);
					}
				}).then(res => {
					resolve(res)
				}).catch(error => reject(`Request failed (${url}).  Returned error of ${error}`));
		});
	}

	async api_post(url, data) {
		if (data == null || data == undefined) data = {};

		data.v = new Date().getTime();

		const urlApi = this._config.api_url + url;
		let response = await fetch(urlApi, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: this._utils.param(data),
		});

		if (response.ok) {
			return response.json();
		} else {
			return Promise.reject(`Request failed.  Returned status of ${response.status}: ${response.statusText}`);
		}
	}

	async battle_api_post(url, data) {
		if (data == null || data == undefined) data = {};

		data.v = new Date().getTime();

		let response = await fetch(this._config.battle_api_url + url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: this._utils.param(data),
		});

		if (response.ok) {
			return response.json();
		} else {
			return Promise.reject(`Request failed.  Returned status of ${response.status}: ${response.statusText}`);
		}
	}

	player_logout(playerName) {
		let loguedPlayer = this._players.find(p => p.name === playerName);
		if (loguedPlayer && loguedPlayer.socket) {
			loguedPlayer.socket.close();
			loguedPlayer = null;
		}
	}

	player_ping_to_server(playerName) {
		const loguedPlayer = this._players.find(p => p.name === playerName);
		if (loguedPlayer && loguedPlayer.socket) {
			//console.log(`@${playerName} ping to server`)
			loguedPlayer.socket.ping();
		}
	}

	resume_match(playerName) {
		const loguedPlayer = this._players.find(p => p.name === playerName);
		if (loguedPlayer && loguedPlayer.match)
			loguedPlayer.match = null;
	}

	get_server_time_offset() { this._server_time_offset }

	get_dynamic_global_properties() {
		return new Promise((resolve, reject) => {
			hive.api.getDynamicGlobalProperties((err, result) => {
				if (err)
					reject(err)
				else
					resolve(result)
			});
		})
	}
}

module.exports = Splinterlands;
