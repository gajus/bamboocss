var _bamboocss_config = require("@bamboocss/config");
Object.keys(_bamboocss_config).forEach(function(k) {
	if (k !== "default" && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
		enumerable: true,
		get: function() {
			return _bamboocss_config[k];
		}
	});
});
