var _ = require('lodash');
var debug = require('debug')('monoxide');
var debugAggregate = require('debug')('monoxide:aggregate');
var debugDetail = require('debug')('monoxide:detail');
var eventer = require('@momsfriendlydevco/eventer');
var fspath = require('path');
var glob = require('globby');

/**
* Collection instance
* @param {Monoxide} o Monoxide parent instance
* @param {string} name Unique name of the collection, corresponds to the name used as the collection name in Mongo
* @param {Object} [schema] Optional schema to populate
* @emits loading Emitted when a collection is being first loaded
* @emits schema Emitted as (schema) when a schema is about to be processed
* @emits ready Emitted as () when a collection has fully loaded, also trappable via the monoxide event 'collection'
* @emits doc Emitted as (doc) when a new MonoxideDocument instance is created for this collection (also used to set `default` properties)
* @emits docNode Emitted as (WalkerNode) when iterating through a document after `doc` has been created
* @emits docNode:TYPE Emitted as (WalkerNode) when iterating through a document after `doc` has been created, matches a specific node type
* @emits docCreated Emitted as (doc) when all emitters have finished
* @emits resolve Emitted as (doc) when a MonoxideDocument instance is run via toObject, such as when its being saved (also used to set `value` properties)
* @emits resolveNode Emitted as (WalkerNode) when iterating through a document during a resolve operation
* @emits resolveNode:TYPE Emitted as (WalkerNode) when iterating through a document during a resolve operation, matches a specific node type
* @emits resolved Emitted after all resolve emitters have finished
* @emits save Emitted as (doc) when a MonoxideDocument is about to be created or saved
* @emits saved Emitted as (doc) when a MonoxideDocument has been created / saved
* @emits aggregate Emitted as (queryOpts) before an aggregation operation
*/
module.exports = function MonoxideCollection(o, name, schema) {
	var c = this;

	/**
	* The string name of the collection, case sensitive
	* This also corresponds to the Mongo collection name
	* @var {string}
	*/
	c.name = name;


	/**
	* The Monoxide schema of this collection
	* This is the result of `new monoxide.classes.Schema(o, schema).schema`
	* The schema is automatically setup if schema is passed in the constructor, otherwise it needs creating from `new o.classes.Schema()`
	* @var {MonoxideSchema}
	*/
	c.schema;


	/**
	* Handle for the Mongo collection when the schema has been compiled via c.createCollection()
	* @var {MongoCollection}
	*/
	c.mongoCollection;


	/**
	* Set of loaded plugins
	* @var {Set}
	*/
	c.loadedPlugins = new Set();


	// Creation (+schema validation) and destruction {{{
	/**
	* Create the intial table schema
	* @returns {Promise <MonoxideCollection>} A promise which will resolve with the collection when the table has been created
	*/
	c.createCollection = ()=> Promise.resolve()
		// Load schema {{{
		.then(()=> c.schema || schema) // Determine schema to use
		.then(schema => schema || Promise.throw('MonoxideCollection.schema needs to be populated before a table can be created'))
		.then(schema => c.emit('schema', schema))
		.then(schema => {
			debugDetail(`Create table "${c.name}" using parsed schema`, c.schema);
			c.schema = new o.classes.Schema(o, c, schema);
		})
		// }}}
		// Load default plugins {{{
		.then(()=> c.use(...o.settings.collections.plugins))
		// }}}
		// Load Mongo collection handle {{{
		.then(()=> {
			c.mongoCollection = o.mongo.collection(c.name);
			if (!c.mongoCollection) throw new Error('Collection not found in MongoDB-Core - did you forget to call monoxide.schema(\'name\', <schema>) first?');
		})
		// }}}
		// Final emiters {{{
		.then(()=> c.emit('ready'))
		.then(()=> o.emit('collection', c))
		.then(()=> c);
		// }}}


	/**
	* Destroy the collection and remove it and all data from the database
	* @param {Object} [options] Additional options
	* @param {boolean} [options.removeMonoxide=true] If true the collection is also removed from the `monoxide.collections` lookup object
	* @param {boolean} [options.ignoreNotExist=true] Don't raise an error if the collection is already absent
	* @returns {Promise} A promise which will resolve when the collection has been removed
	*/
	c.dropCollection = options => {
		var settings = {
			removeMonoxide: true,
			ignoreNotExist: true,
			...options,
		};

		return Promise.resolve()
			.then(()=> debug('Remove collection', c.name))
			.then(()=> c.mongoCollection.drop())
			.then(()=> debug('Dropped collection', c.name))
			.then(()=> settings.removeMonoxide && delete o.collections[c.name])
			.catch(e => settings.ignoreNotExist && e.code === 26 ? Promise.resolve() : Promise.reject(e))
	};
	// }}}

	// MonoxideQuery shortcuts {{{
	/**
	* Begin a find operation
	* Really this just instanciates and passes a MonoxideQuery instance
	* @param {Object} [query...] The query to populate the query builder with
	* @returns {MonoxideQuery} A query builder class
	*/
	c.find = (...query) => (new o.classes.Query(o, c)).find(...query);


	/**
	* Shortcut function to create a query builder and limit its results, mutating the response to the first document found
	* @param {Object} [query...] The query to populate the query builder with
	* @returns {MonoxideQuery} A query builder class
	*/
	c.findOne = (...query) => c.find(...query).one();


	/**
	* Shortcut function to create a query builder and limit its results, mutating the response to the first document found
	* @param {Object} [query...] The query to populate the query builder with
	* @returns {MonoxideQuery} A query builder class
	*/
	c.findOneById = id => c.find({_id: id}).one();


	/**
	* Alias of c.findOneById
	* @alias findOneById()
	*/
	c.findOneByID = c.findOneById;


	/**
	* Shortcut function to create a query builder element and set its count property
	* @param {Object} [query...] The query to populate the query builder with
	* @returns {MonoxideQuery} A query builder class
	*/
	c.count = (...query) => c.find(...query).count();
	// }}}

	// Aggregation {{{
	/**
	* Execute an aggregation query
	* @param {string} collection The collection to run the aggregation on
	* @param {array} aggregation The aggregation query to run
	* @param {Object} [options] Additional aggregation options
	* @returns {Promise <MonoxideCursor>} A Monxoide cursor
	*/
	c.aggregate = (aggregation, options = {}) => new Promise((resolve, reject) => {
		if (debugAggregate.enabled) debugAggregate(
			`monoxide.collections.${c.name}.aggregate([\n`
			+ aggregation.map(line => '\t' + JSON.stringify(line)).join('\n')
			+ '\n]);'
		);

		c.mongoCollection.aggregate(aggregation, options, (err, cursor) => {
			if (err) {
				debugAggregate('Aggregation error:', err);
				return reject(err);
			}
			resolve(new o.classes.Cursor(o, c, cursor));
		})
	})
	// }}}

	// Statics, Virtuals and Methods {{{
	/**
	* Add a custom static method to this collection
	* @param {string} name The name of the method to add
	* @param {function} func The function payload of the method
	* @returns {MonoxideCollection} This chainable collection
	*/
	c.static = (name, func) => {
		m[name] = func;
		return c;
	};


	/**
	* Storage for all registered methods
	* @var {Object} Object with each key as the named method and the value as the function
	*/
	c.methods = {};


	/*
	* Add a method to a collection, this method will be available on all documents that are non-lean
	* @param {string} name The name of the method to add
	* @param {function} func The function payload of the method
	* @returns {MonoxideCollection} This chainable collection
	*/
	c.method = (name, func) => {
		c.methods[name] = func;
		return c;
	};


	/**
	* Storage for all registered virtuals
	* @var {Object} Object with each key as the named method
	* @property {function} get The get function for the virtual, may return a scalar or promise, called as `(doc)`
	* @property {function} set The set function for the virtual, may return a scalar or promise, called as `(doc)`
	*/
	c.virtuals = {};


	/*
	* Add a virtual to a collection this acts like a glued-on field for a non-lean document
	* @param {string} name The name of the virtual to add
	* @param {function} [getter] Function used to get the value of the virtual. Called as `(doc)`
	* @param {function} [setter] Function used to set the value of the virtual. Called as `(doc)`
	* @returns {MonoxideCollection} This chainable collection
	*/
	c.virtual = (name, getter, setter) => {
		c.virtuals[name] = {getter, setter};
		return c;
	};
	// }}}

	// Document creation, update and destruction {{{
	/**
	* Create a single document within a collection
	* @returns {Promise <MonoxideDocument>} A promise which will resolve to the created document
	*/
	c.create = doc => new o.classes.Document(o, c, doc)
		.then(obj => obj.$create());


	/**
	* Create multiple documents as an array
	* @returns {Promise <Array MonoxideDocument>} A promise which will resolve will all created documents
	*/
	c.createMany = docs => Promise.all(docs.map(doc =>
		new o.classes.Document(o, c, doc)
			.then(obj => obj.$create())
	));


	/**
	* @alias create()
	*/
	c.insertOne = c.create;


	/**
	* Merge updates into a single document via a query
	* @param {Object} id The document ID to update
	* @param {Object} patch The patch data to merge
	* @returns {Promise <MonoxideDocument>} A promise which will resolve when the document has been updated
	*/
	c.updateOne = (query, patch) => c.findOne(query)
		.then(v => {
			console.log('GOT DOC', {query, v, patch});
			return v;
		})
		.then(doc => doc || Promise.reject('Document not found when performing update'))
		.then(doc => doc.$setMany(patch))
		.then(doc => doc.save());


	/**
	* Merge updates into an existing document by its ID
	* @param {Object} id The document ID to update
	* @param {Object} patch The patch data to merge
	* @returns {Promise <MonoxideDocument>} A promise which will resolve when the document has been updated
	*/
	c.updateOneById = (id, patch) => c.findOneById(id)
		.then(doc => doc || Promise.reject('Document not found when performing update'))
		.then(doc => doc.$setMany(patch))
		.then(doc => doc.save());


	/**
	* @alias create()
	*/
	c.updateOneByID = c.updateOneById;


	/**
	* Merge updates into a all matching documents via a query
	* @param {Object} query The query to find documents via
	* @param {Object} patch The patch data to merge
	* @returns {Promise} A promise which will resolve when the document has been updated (no data is returned)
	*/
	c.updateMany = (query, patch) => c.find(query)
		.then(docs => Promise.all(docs.map(doc =>
			doc.$setMany(patch)).then(doc => doc.save())
		))


	/**
	* Delete a single document
	* @param {Object} query Query to use when deleting
	* @returns {Promise} A promise which will resolve when the document has been removed
	*/
	c.deleteOne = c.delete = query => c.mongoCollection.deleteOne(query);


	/**
	* Delete a single document by its ID
	* @param {Object} id The document ID to delete
	* @returns {Promise} A promise which will resolve when the document has been removed
	*/
	c.deleteOneById = id => c.mongoCollection.deleteOneById(query);


	/**
	* Delete a multiple matching documents
	* @param {Object} query Query to use when deleting
	* @returns {Promise} A promise which will resolve when the document has been removed
	*/
	c.deleteMany = query => c.mongoCollection.deleteMany(query);
	// }}}

	// Plugins {{{
	/**
	* Inject one or more plugins into a collection
	* Can be populated in three ways:
	* 	- Function - Call as a factory function as `(monoxide, collection)`
	* 	- String - Expect the plugin to be discoverable within the paths specified in monoxide.settings.plugins.paths
	* 	- [String, Object] - Babel syntax where the discoverable module + config can be specified as a single value - used to populate name + settings pairs
	* 	- Undefined / falsy - ignored
	* @param {function|string|array} plugin... Plugins to inject, a factory be called as `(monoxide, collection)`, a string or an array of the form [string, object] in Babel stype config
	* @returns {MonoxideCollection} This chainable collection object
	*/
	c.use = (...plugins) => {
		plugins.forEach(plugin => {
			var pluginPath;

			if (!plugin) { // Ignore falsy values
				// Pass
			} else if (_.isFunction(plugin)) { // Factory function
				if (c.loadedPlugins.has(plugin)) return;
				c.loadedPlugins.add(plugin);
				debugDetail('Load factory plugin against collection', c.name);
				plugin.call(c, o, c, {});
			} else if (_.isString(plugin)) { // Plain string
				pluginPath = glob.sync(o.settings.plugins.paths.map(path => fspath.join(path, `${plugin}.js`)));
				if (!pluginPath.length) throw new Error(`Cannot locate collection plugin "${plugin}" in available paths`);
				if (c.loadedPlugins.has(pluginPath[0])) return;
				c.loadedPlugins.add(pluginPath[0]);
				debugDetail(`Load plugin "${pluginPath[0]}" against collection`, c.name);
				require(pluginPath[0]).call(c, o, c, {});
			} else if (_.isArray(plugin) && _.isString(plugin[0]) && _.isPlainObject(plugin[1])) { // [stringName, objectConfig]
				pluginPath = glob.sync(o.settings.plugins.paths.map(path => fspath.join(path, `${plugin[0]}.js`)));
				if (!pluginPath.length) throw new Error(`Cannot locate collection plugin "${plugin[0]}" in available paths`);
				if (c.loadedPlugins.has(pluginPath[0])) return;
				c.loadedPlugins.add(pluginPath[0]);
				debugDetail(`Load plugin "${pluginPath[0]}" with config against collection`, c.name);
				require(pluginPath[0]).call(c, o, c, plugin[1]);
			} else {
				throw new Error('Unsupported plugin load format');
			}
		})
		return c;
	}
	// }}}

	eventer.extend(c);

	return c;
};
