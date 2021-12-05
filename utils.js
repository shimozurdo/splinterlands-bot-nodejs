const crypto = require('crypto');
class Utils {

	constructor(splinterlands) {
		this._splinterlands = splinterlands;
	}

	random_str(length) {
		var charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
			retVal = "";
		for (var i = 0, n = charset.length; i < length; ++i) {
			retVal += charset.charAt(Math.floor(Math.random() * n));
		}
		return retVal;
	}

	format_tx_id(id) {
		let prefix = (this._splinterlands.get_settings().test_mode) ? `${this._splinterlands.get_settings().prefix}sm_` : 'sm_';

		if (!id.startsWith(prefix))
			id = `${prefix}${id}`;

		return id;
	}

	format_tx_data(data) {
		if (!data)
			data = {};

		data.app = `sl-mobile/${this._splinterlands.get_settings().version}`;

		// Generate a random ID for this transaction so we can look it up later
		if (!data.sm_id)
			data.sm_id = this.random_str(10);

		// Append the prefix to the app name if in test mode
		if (this._splinterlands.get_settings().test_mode)
			data.app = `${this._splinterlands.get_settings().prefix}${data.app}`;

		if (JSON.stringify(data).length > 2000)
			throw new Error('Max custom_json data length exceeded.');

		return data;
	}

	param(object) {
		var encodedString = '';
		for (var prop in object) {
			if (Object.prototype.hasOwnProperty.call(object, prop)) {
				if (encodedString.length > 0) {
					encodedString += '&';
				}
				encodedString += prop + '=' + encodeURIComponent(object[prop]);
			}
		}
		return encodedString;
	}

	try_parse(json) {
		try {
			return (typeof json == 'string') ? JSON.parse(json) : json;
		} catch (err) {
			console.log('Error trying to parse JSON: ' + json);
			return null;
		}
	}

	asset_url(path) { return this._splinterlands.get_settings().asset_url + path; }

	server_date(date_str, subtract_seconds) {
		let date = new Date(new Date(date_str).getTime() + this._splinterlands.get_server_time_offset());

		if (subtract_seconds)
			date = new Date(date.getTime() - subtract_seconds * 1000);

		return date;
	}

	md5(summoner, monsters, secret) {
		let str = Buffer.from((summoner + ',' + monsters.join(',') + ',' + secret), 'utf-8').toString();

		let hash = crypto.createHash('md5');
		hash.update(str);
		let teamHash = hash.digest('hex');

		return teamHash;
	}
}

module.exports = Utils

