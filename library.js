"use strict";


var controllers = require('./lib/controllers'),
	winston = module.parent.require('winston'),
	User = module.parent.require('./user'),
	Posts = module.parent.require('./posts'),
	Topics = module.parent.require('./topics'),
	Categories = module.parent.require('./categories'),
	Meta = module.parent.require('./meta'),
	db = module.parent.require('./database'),
	async = module.parent.require('async'),
	_ = module.parent.require('underscore'),
	SocketPlugins = module.parent.require('./socket.io/plugins'),
	cheerio = require('cheerio'),

	plugin = {};

function parsePost(post, match) {
//				winston.info('[RtoS] match: ' + match);
	var $ = cheerio.load(post.content, {
		decodeEntities: false
	});
//				winston.info('[RtoS] content before:\n' + post.content);
	if (!match) {
		$('p:contains("[hide]")').each(function (idx, element) {
			var $ele = $(element);
			$ele.nextUntil('p:contains("[/hide]")').remove();
			// below is [/hide]
			$ele.next().remove();
			$ele.replaceWith($('<code class="rtos">[内容回复后可见！]</code>'));
		});
	}
	else {
		$('p:contains("[hide]")').each(function (idx, element) {
			var $ele = $(element);
			var hideContent = $ele.nextUntil('p:contains("[/hide]")');
//						winston.info('[RtoS] hide content :\n' + hideContent);
			$ele.after('<div class="rtos"></div>');
			$ele.next().append(hideContent);
			$ele.remove();
		});
		$('p:contains("[/hide]")').remove();
	}
	post.content = $.html();
}
function replyToSeeFilter(uid, post, callback) {
	Topics.getTopicField(parseInt(post.tid, 10), 'replyerIds', function (err, replyerIds) {
		var isRtos = /<p>\[hide]\s*<\/p>/.test(post.content);
		if (isRtos) {
			winston.info('[RtoS] get rtos post, tid : ' + post.tid);
			var match = false;
			User.isAdministrator(uid, function (err, isAdmin) {
				if (isAdmin || uid == post.uid) {
					match = true;
				}
				else {
					if (replyerIds) {
						if (_.indexOf(JSON.parse(replyerIds), parseInt(uid)) >= 0) {
							match = true;
						}
					}
				}
				parsePost(post, match);
//				winston.info('[RtoS] content after:\n' + post.content);
				callback(null, post);
			})
		}
		else {
			callback(null, post);
		}
	})
}

function handleSocketIO() {
	SocketPlugins.replyToSee = {};

	SocketPlugins.replyToSee.renderTopic = function (socket, data, callback) {
		async.waterfall([
			async.apply(Topics.getPids, data.tid),
			function (pids, aCallback) {
				return Posts.getPostsByPids([pids[0]], socket.uid, aCallback);
			}
		], function (err, posts) {
			if (err) {
				return callback(err);
			}
			parsePost(posts[0], true);
			return callback(null, posts[0]);
		});
	};
}


plugin.init = function (params, callback) {
	var router = params.router,
		hostMiddleware = params.middleware,
		hostControllers = params.controllers;

	// We create two routes for every view. One API call, and the actual route itself.
	// Just add the buildHeader middleware to your route and NodeBB will take care of everything for you.

	router.get('/admin/plugins/reply2see', hostMiddleware.admin.buildHeader, controllers.renderAdminPage);
	router.get('/api/admin/plugins/reply2see', controllers.renderAdminPage);

	handleSocketIO();
	callback();
};

plugin.getPostContent = function (data, callback) {
	replyToSeeFilter(data.uid, data.posts[0], function (err, post) {
		callback(err, data);
	});
};

plugin.setReplyerId = function (data, callback) {
	Topics.getTopicData(parseInt(data.tid), function (err, fields) {

		var replyerIds = fields.replyerIds ? JSON.parse(fields.replyerIds) : [];
		if (_.indexOf(replyerIds, parseInt(data.uid)) === -1) {
			replyerIds.push(parseInt(data.uid));
			Topics.setTopicField(parseInt(data.tid), 'replyerIds', JSON.stringify(replyerIds));
		}
	});
	callback(null, data);
};

plugin.addAdminNavigation = function (header, callback) {
	header.plugins.push({
		route: '/plugins/reply2see',
		icon : 'fa-tint',
		name : 'Rely post to see content'
	});

	callback(null, header);
};

plugin.getCategories = function (data, callback) {
//	winston.info('[RtoS] filter summary post:\n' + data);
	var pids = [],
		pidMap = {};
	data.templateData.categories.forEach(function (category) {
		if (category.posts[0]) {
			pids.push(category.posts[0].pid);
			pidMap[category.posts[0].pid] = category.posts[0];
		}
	});

	Posts.getPostsFields(pids, ['pid', 'tid'], function (err, posts) {
		posts.forEach(function (post) {
			pidMap[post.pid].tid = post.tid;
		});

		async.each(data.templateData.categories, function (category, aCallback) {
			if (category.posts[0]) {
				return replyToSeeFilter(data.req.uid, category.posts[0], aCallback);
			}
			aCallback();
		}, function (err) {
			callback(err, data);
		});
	});
};

plugin.getPostSummaryByPids = function (data, callback) {
	async.each(data.posts, function (post, aCallback) {
		replyToSeeFilter(data.uid, post, aCallback);
	}, function (err) {
		callback(err, data);
	});
};

module.exports = plugin;