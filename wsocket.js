const W3CWebSocket = require('websocket').w3cwebsocket;

class WSocket {
    constructor(ws_url, playerName, splinterlands) {
        this._splinterlands = splinterlands;
        this._player = splinterlands._players.find(p => p.name === playerName);
        if (!this._connected) {
            this._socket = new W3CWebSocket(ws_url);
            this._socket.onopen = this.on_open.bind(this);
            this._socket.onmessage = this.on_message.bind(this);
            this._socket.onclose = this.on_close.bind(this);
            this.load_messages();
        } else {
            if (this.player.showInLog && this._connected)
                console.log("** The socket already is connected");
        }
    }

    send(message) { this._socket.send(JSON.stringify(message)); }

    on_open() {
        if (!this._player.sessionId)
            this._player.sessionId = this._splinterlands._utils.random_str(10);
        this.send({ type: 'auth', player: this._player.name, access_token: this._player.token, session_id: this._player.sessionId });
    }

    on_message(m) {
        const message = JSON.parse(m.data);

        // const data = message.data || {}
        // const trx_info = data.trx_info ? data.trx_info : {};
        // const msg = `${message.status ? "status: " + message.status + ", " : ""}${message.id ? "id: " + message.id + ", " : ""}${data.sm_id ? "sm_id: " + data.sm_id + ", " : ""}${trx_info.type ? "type: " + trx_info.type + ", " : ""}${data.player ? "player: " + data.player + ", " : ""}${data.opponent_player ? "opponent: " + data.opponent_player + ", " : ""}${data.rulset ? "rulset: " + data.rulset + ", " : ""}${data.mana_cap ? "mana_cap: " + data.mana_cap + ", " : ""}${trx_info.success ? "success: " + trx_info.success : ""}${trx_info.error ? "error:" + trx_info.error : ""}`;
        // console.log("** Message -", msg);

        if (message.status === 'authenticated') {
            //clearTimeout(this._player.on_login_timeout);
            //console.log(`** @${this._player.name} on_login: `, this._player.on_login)
            if (this._player.on_login) {
                this._connected = true;
                this._player.on_login({ success: true });
            }
        }

        if (message && message.server_time)
            this._splinterlands._server_time_offset = Date.now() - message.server_time;

        if (message.id && this._message_handlers[message.id])
            this._message_handlers[message.id](message.data);

        // Send acknowledgement if one is requested
        if (message.ack)
            this.send({ type: 'ack', msg_id: message.msg_id });
    }

    load_messages() {
        this._message_handlers = {
            transaction_complete: (data) => {
                let trx = this._splinterlands._transactions[data.sm_id];
                //console.log("** trx", trx);
                if (trx) {
                    clearTimeout(trx.timeout);
                    trx.resolve(data);
                }
            },

            match_found: (data) => {
                let player = this._splinterlands._players.find(p => p.match && p.match.id == data.id);
                if (!player) {
                    console.log("** match_found, Player not found")
                    return;
                }
                //(match.id == data.opponent) check is for challenges 
                if (player.match && (player.match.id == data.id || player.match.id == data.opponent)) {
                    player.match = this._splinterlands.set_match(data, player);

                    if (player.match.on_match)
                        player.match.on_match(player.match);
                }
            },

            match_not_found: (data) => {
                let player = this._splinterlands._players.find(p => p.match && p.match.id == data.id);
                if (!player) {
                    console.log("** match_not_found, Player not found")
                    return;
                }
                if (player.match && player.match.id == data.id) {
                    if (player.match.on_timeout)
                        player.match.on_timeout({ error: 'No suitable opponent could be found, please try again.', code: 'match_not_found' });

                    player.match = null;
                }
            },

            opponent_submit_team: (data) => {
                let player = this._splinterlands._players.find(p => p.match && p.match.id == data.id);
                if (!player) {
                    console.log("** Opponent_submit_team, player not found")
                    return;
                }
                if (player.match && player.match.id == data.id) {
                    player.match = this._splinterlands.set_match(data, player);

                    if (player.match.on_opponent_submit)
                        player.match.on_opponent_submit(player.match);
                }
            },

            battle_cancelled: (data) => {
                let player = this._splinterlands._players.find(p => p.match && p.match.id == data.id);
                if (!player) {
                    console.log("** battle_cancelled, Player not found")
                    return;
                }
                if (player.match && player.match.id == data.id) {
                    if (player.match.on_timeout)
                        player.match.on_timeout({ error: 'Neither player submitted a team in the allotted time so the match has been cancelled.', code: 'match_cancelled' });

                    player.match = null;
                }
            },

            battle_result: async (data) => {
                let player = this._splinterlands._players.find(p => p.match && p.match.id == data.id);
                if (!player) {
                    console.log("** battle_result, Player not found")
                    return;
                }
                if (player.match && player.match.id == data.id) {
                    if (player.match.on_result)
                        await player.match.on_result(data.id)
                    player.match = null;
                }
            },
        }
    }

    close() { this._socket.close(); }

    ping() { this.send({ type: 'ping' }); }

    on_close(e) {
        if (this._player.showInLog)
            console.log(`Socket disconnect, player ${this._player.name}`, e);
        this._connected = false;
    }
}

module.exports = WSocket;