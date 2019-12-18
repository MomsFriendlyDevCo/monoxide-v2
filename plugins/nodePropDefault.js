var _ = require('lodash');
var debugDetail = require('debug')('monoxide:detail');

/**
* Monoxide collection plugin
* Add a default value to all nodes
* The function can be a scalar or Promise compatible return
* If the default is specified as a function it is called as `(walkerNode)` and expected to return a scalar
* @param {Monoxide} monoxide Monoxide parent instance
* @param {MonoxideCollection} collection Collection instance
* @param {Object} [options] Additional configuration options
*/
module.exports = function MonoxidePluginStringOIDs(o, collection, options) {
	var settings = {
		...options,
	};

	// Assign the default value if we both have a default AND the node value is undefined
	collection.on('docNode', node => {
		if (node.schema.default !== undefined && node.value === undefined) {
			return Promise.resolve(_.isFunction(node.schema.default) ? node.schema.default(node) : node.schema.default)
				.then(res => {
					if (debugDetail.enabled) debugDetail('Plugin:NodePropDefault assigned default value for ID', node.doc._id, 'for prop', node.docPath.join('.'), '=', res, _.isFunction(node.schema.default) && '(via function return)');
					return node.replace(res);
				})
		}
	});
};