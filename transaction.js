class Transaction {
	constructor(data, splinterlands) {
		Object.keys(data).forEach(k => this[k] = data[k]);
		this.data = splinterlands._utils.try_parse(this.data);
		this.result = splinterlands._utils.try_parse(this.result);
	}
}

module.exports = Transaction