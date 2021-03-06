var expect = require('chai').expect;
var monoxide = require('..');
var mlog = require('mocha-logger');

var mongoURI = 'mongodb://localhost/monoxide-test';

// Setting this to FALSE will disable the database teardown (i.e. not erase the Schema + DB when done)
// This is useful for debugging but only with single scripts as each test script will expect a fresh database
var allowTeardown = process.env.TEARDOWN ? process.env.TEARDOWN=='true' : true;

var setup = module.exports = {
	// init {{{
	init() {
		this.timeout(30 * 1000);

		return Promise.resolve()
			.then(()=> setup.initConnection())
			.then(()=> setup.initSchemas())
			.then(()=> setup.initScenarios())
	},
	// }}}

	// teardown {{{
	teardown() {
		if (!allowTeardown) {
			mlog.error('Skipping teardown');
			mlog.log('To examine use `mongo ' + mongoURI.replace(/^.+\/(.*)?/, '$1') + '`');
			return Promise.resolve();
		}

		return Promise.resolve()
			.then(()=> setup.teardownSchemas())
			.then(()=> setup.teardownConnection())
	},
	// }}}

	// initConnection {{{
	initConnection() {
		return monoxide.connect(mongoURI);
	},
	// }}}

	// initSchemas {{{
	initSchemas() {
		// Users {{{
		var Users = monoxide
			.schema('users', {
				company: {type: 'pointer', ref: 'companies', index: true},
				name: String,
				status: {type: 'string', enum: ['active', 'unverified', 'deleted'], default: 'unverified', index: true},
				role: {type: String, enum: ['user', 'admin'], default: 'user', index: true},
				_password: String,
				mostPurchased: [{
					number: Number,
					widget: {type: 'pointer', ref: 'widgets', index: true},
				}],
				widgets: [{type: 'pointer', ref: 'widgets', index: true}],
				favourite: { // Intentionally has no defaulting children
					color: {type: 'string'},
					animal: {type: 'string'},
					widget: {type: 'pointer', ref: 'widgets', index: true},
				},
				settings: {
					lang: {type: String, enum: ['en', 'es', 'fr'], default: 'en'},
					greeting: {type: 'string', default: 'Hello'},
				},
			})
			.virtual('password',
				()=> 'RESTRICTED',
				(pass, doc) => { // Very crappy, yet predictable password hasher that removes all consonants
					doc._password = pass
						.toLowerCase()
						.replace(/[^aeiou]+/g, '');
				}
			)
			.virtual('passwordStrength', doc => doc._password ? doc._password.length : 0) // Returns the length of the (badly, see above) hashed password which is an approximate indicator of hash strength
			.method('greet', doc => `${doc.settings.greeting} ${doc.name}`)
			.use('nodeTypeOid')
		// }}}

		// Companies {{{
		var Companies = monoxide.schema('companies', {
			name: String,
		})
			.use('nodeTypeOid')
		// }}}

		// Widgets {{{
		var Widgets = monoxide.schema('widgets', {
			created: {type: Date, default: Date.now},
			name: String,
			content: String,
			status: {type: 'string', enum: ['active', 'deleted'], default: 'active', index: true},
			color: {type: 'string', enum: ['red', 'green', 'blue', 'yellow'], default: 'blue', index: true, customArray: [1, 2, 3]},
			featured: {type: 'boolean', default: false, customObject: {foo: 'Foo!', bar: 'Bar!'}},
		})
			.use('nodeTypeOid')
		// }}}

		return monoxide.init();
	},
	// }}}

	// initScenarios {{{
	initScenarios() {
		return monoxide.scenario(require('./scenario'), {nuke: true});
	},
	// }}}

	// teardownConnection {{{
	teardownConnection() {
		return monoxide.disconnect();
	},
	// }}}

	// teardownSchemas {{{
	teardownSchemas() {
		return Promise.all(
			Object.keys(monoxide.collections).map(collectionName =>
				monoxide.collections[collectionName].dropCollection()
			)
		)
		.then(()=> monoxide.dropDatabase())
	},
	// }}}
};
