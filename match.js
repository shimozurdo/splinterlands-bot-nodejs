class Match {
	constructor(data, splinterlands) {
		this._splinterlands = splinterlands;
		this.update(data);
	}

	update(data) {
		Object.keys(data).forEach(k => this[k] = data[k]);
		const { _splinterlands } = this;
		if (this.match_date) {
			this.inactive = this.inactive.split(',');
			this.ruleset = this.ruleset.split('|');
			this.settings = _splinterlands._utils.try_parse(this.settings);
			this.rating_level = this.settings ? this.settings.rating_level : null;
			this.allowed_cards = this.settings ? this.settings.allowed_cards : null;
		}

		if (this.submit_expiration_date)
			this.submit_expiration_date = _splinterlands._utils.server_date(this.submit_expiration_date, 20);

		return this;
	}

	get ruleset_images() {
		return this.ruleset.map(r => this._splinterlands._utils.asset_url(`website/icons/rulesets/new/img_combat-rule_${r.toLowerCase().replace(/[^a-zA-Z]+/g, '-')}_150.png`));
	}
}

module.exports = Match
